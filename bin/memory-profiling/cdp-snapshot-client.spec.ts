/**
 * Unit tests for CdpSnapshotClient
 *
 * Uses vi.mock for 'ws' and vi.stubGlobal for 'fetch'.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------
// We share mock instances via a module-level array so tests can reach them.

type WsEventHandler = (...args: unknown[]) => void;

const mockWsInstances: MockWebSocket[] = [];

class MockWebSocket {
  url: string;
  readyState = 1; // OPEN
  private handlers: Record<string, WsEventHandler[]> = {};

  constructor(url: string) {
    this.url = url;
    mockWsInstances.push(this);
  }

  on(event: string, handler: WsEventHandler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    return this;
  }

  once(event: string, handler: WsEventHandler) {
    const wrapper: WsEventHandler = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    return this.on(event, wrapper);
  }

  off(event: string, handler: WsEventHandler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter((h) => h !== handler);
    }
    return this;
  }

  send(_data: string) {
    // No-op by default; individual tests override this
  }

  close() {
    this.readyState = 3; // CLOSED
    this._emit('close');
  }

  _emit(event: string, ...args: unknown[]) {
    for (const handler of [...(this.handlers[event] ?? [])]) {
      handler(...args);
    }
  }

  _simulateOpen() {
    this._emit('open');
  }

  _simulateError(err: Error) {
    this._emit('error', err);
  }

  _simulateMessage(data: unknown) {
    this._emit('message', JSON.stringify(data));
  }
}

// vi.mock is hoisted — the factory closure references the module-level class
vi.mock('ws', () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket,
}));

// ---------------------------------------------------------------------------
// Import under test (after mock is set up)
// ---------------------------------------------------------------------------
const { createCdpSnapshotClient } = await import('./cdp-snapshot-client');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flush enough microtask ticks to let the async fetch+json+WS-creation chain
 * complete.  The connect() path is: await fetch → await response.json() →
 * new WebSocket(), which is approximately 3-4 microtask hops.  We flush 10
 * times to be safe.
 */
async function flushMicrotasks(count = 10): Promise<void> {
  for (let i = 0; i < count; i++) {
    // biome-ignore lint/performance/noAwaitInLoops: intentional sequential microtask flush
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CdpSnapshotClient', () => {
  let tmpDir: string;

  beforeEach(() => {
    mockWsInstances.length = 0;
    tmpDir = fs.mkdtempSync(path.join('/tmp', 'cdp-test-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // connect()
  // -------------------------------------------------------------------------
  describe('connect()', () => {
    it('connects after getting webSocketDebuggerUrl from /json/list', async () => {
      const wsUrl = 'ws://127.0.0.1:9229/devtools/page/xxx';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => [{ webSocketDebuggerUrl: wsUrl }],
        }),
      );

      const client = createCdpSnapshotClient();
      const connectPromise = client.connect('http://127.0.0.1:9229');

      // Flush microtasks so the fetch+json+WS construction chain completes
      await flushMicrotasks();

      expect(mockWsInstances.length).toBeGreaterThan(0);
      mockWsInstances[0]._simulateOpen();

      await connectPromise;

      expect(mockWsInstances[0].url).toBe(wsUrl);
    });

    it('retries on fetch failure up to 5 times then throws', async () => {
      vi.useFakeTimers();

      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('connection refused'));
      vi.stubGlobal('fetch', fetchMock);

      const client = createCdpSnapshotClient();
      // Attach a no-op catch immediately to prevent PromiseRejectionHandledWarning
      // when the rejection arrives before the `await expect(...).rejects` handler.
      const connectPromise = client.connect('http://127.0.0.1:9229');
      connectPromise.catch(() => undefined);

      // runAllTimersAsync flushes all pending timers AND microtasks
      // repeatedly until both queues are empty, covering all retry delays
      await vi.runAllTimersAsync();

      await expect(connectPromise).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(5);

      vi.useRealTimers();
    }, 10000);

    it('retries on WebSocket error and succeeds on second attempt', async () => {
      vi.useFakeTimers();

      const wsUrl = 'ws://127.0.0.1:9229/devtools/page/xxx';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => [{ webSocketDebuggerUrl: wsUrl }],
        }),
      );

      const client = createCdpSnapshotClient();
      const connectPromise = client.connect('http://127.0.0.1:9229');

      // Flush microtasks so fetch+json+WS construction completes
      await vi.runAllTimersAsync();

      // First WS instance should exist now
      expect(mockWsInstances.length).toBeGreaterThan(0);
      // Simulate error on first WS connection attempt
      mockWsInstances[0]._simulateError(new Error('ws error'));

      // Advance past the backoff delay and let the second attempt run
      await vi.runAllTimersAsync();

      // Second WS instance should exist; simulate successful open
      expect(mockWsInstances.length).toBeGreaterThan(1);
      mockWsInstances[1]._simulateOpen();

      await connectPromise;

      expect(mockWsInstances).toHaveLength(2);

      vi.useRealTimers();
    }, 10000);
  });

  // -------------------------------------------------------------------------
  // takeSnapshot()
  // -------------------------------------------------------------------------
  describe('takeSnapshot()', () => {
    /** Helper: create a fully connected client */
    async function setupConnectedClient() {
      const wsUrl = 'ws://127.0.0.1:9229/devtools/page/yyy';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => [{ webSocketDebuggerUrl: wsUrl }],
        }),
      );

      const client = createCdpSnapshotClient();
      const connectPromise = client.connect('http://127.0.0.1:9229');

      await flushMicrotasks();

      expect(mockWsInstances.length).toBeGreaterThan(0);
      mockWsInstances[0]._simulateOpen();
      await connectPromise;

      return { client, ws: mockWsInstances[0] };
    }

    it('writes collected snapshot chunks to the output file', async () => {
      const { client, ws } = await setupConnectedClient();

      const outputPath = path.join(tmpDir, 'test.heapsnapshot');

      // Override send to simulate CDP events/responses via setImmediate
      ws.send = (data: string) => {
        const msg = JSON.parse(data) as { id: number; method: string };
        setImmediate(() => {
          if (msg.method === 'HeapProfiler.enable') {
            ws._simulateMessage({ id: msg.id, result: {} });
          } else if (msg.method === 'HeapProfiler.takeHeapSnapshot') {
            ws._simulateMessage({
              method: 'HeapProfiler.addHeapSnapshotChunk',
              params: { chunk: '{"nodes":' },
            });
            ws._simulateMessage({
              method: 'HeapProfiler.addHeapSnapshotChunk',
              params: { chunk: '[1,2,3]}' },
            });
            ws._simulateMessage({
              method: 'HeapProfiler.reportHeapSnapshotProgress',
              params: { done: 100, total: 100, finished: true },
            });
            ws._simulateMessage({ id: msg.id, result: {} });
          }
        });
      };

      await client.takeSnapshot(outputPath);

      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf8');
      expect(content).toBe('{"nodes":[1,2,3]}');
    });

    it('closes the WebSocket when takeSnapshot fails, ensuring connection cleanup (Req 1.5)', async () => {
      const { client, ws } = await setupConnectedClient();

      const outputPath = path.join(tmpDir, 'fail.heapsnapshot');

      // Simulate a fatal socket error on any send
      ws.send = (_data: string) => {
        setImmediate(() => ws._simulateError(new Error('CDP socket error')));
      };

      await expect(client.takeSnapshot(outputPath)).rejects.toThrow(
        'CDP socket error',
      );

      // Observable evidence: WebSocket must be closed after failure (Req 1.5)
      expect(ws.readyState).toBe(3); // CLOSED
    });
  });

  // -------------------------------------------------------------------------
  // close()
  // -------------------------------------------------------------------------
  describe('close()', () => {
    it('closes the WebSocket connection', async () => {
      const wsUrl = 'ws://127.0.0.1:9229/devtools/page/zzz';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: async () => [{ webSocketDebuggerUrl: wsUrl }],
        }),
      );

      const client = createCdpSnapshotClient();
      const connectPromise = client.connect('http://127.0.0.1:9229');

      await flushMicrotasks();
      expect(mockWsInstances.length).toBeGreaterThan(0);
      mockWsInstances[0]._simulateOpen();
      await connectPromise;

      await client.close();

      expect(mockWsInstances[0].readyState).toBe(3); // CLOSED
    });

    it('is safe to call when not connected', async () => {
      const client = createCdpSnapshotClient();
      await expect(client.close()).resolves.toBeUndefined();
    });
  });
});
