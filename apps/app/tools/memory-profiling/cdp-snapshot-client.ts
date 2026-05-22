/**
 * CdpSnapshotClient
 *
 * Connects to a Node.js inspector endpoint via the Chrome DevTools Protocol (CDP)
 * and captures heap snapshots using HeapProfiler.takeHeapSnapshot.
 *
 * Usage:
 *   const client = createCdpSnapshotClient();
 *   await client.connect('http://127.0.0.1:9229');
 *   await client.takeSnapshot('/tmp/memory-leak-investigation/baseline-a.heapsnapshot');
 *   await client.close();
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CdpSnapshotClient {
  connect(inspectorUrl: string): Promise<void>;
  takeSnapshot(outputPath: string): Promise<void>;
  close(): Promise<void>;
}

/** A single CDP message received from the inspector. */
interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of connection attempts (initial + 4 retries = 5 total). */
const MAX_RETRIES = 5;

/** Base delay in milliseconds for exponential backoff. Doubles each retry. */
const BACKOFF_BASE_MS = 1000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new CdpSnapshotClient instance.
 *
 * The returned object manages a single WebSocket connection to a Node.js
 * inspector endpoint and exposes methods to take heap snapshots.
 */
export function createCdpSnapshotClient(): CdpSnapshotClient {
  let ws: WebSocket | null = null;
  let nextCmdId = 1;

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Resolves the webSocketDebuggerUrl from the inspector's /json/list endpoint.
   * Throws if the response contains no targets.
   */
  async function fetchDebuggerUrl(inspectorUrl: string): Promise<string> {
    const response = await fetch(`${inspectorUrl}/json/list`);
    const targets = (await response.json()) as Array<{
      webSocketDebuggerUrl?: string;
    }>;
    if (targets.length === 0 || targets[0].webSocketDebuggerUrl == null) {
      throw new Error(
        `No debuggable targets found at ${inspectorUrl}/json/list`,
      );
    }
    return targets[0].webSocketDebuggerUrl;
  }

  /**
   * Attempts to open a WebSocket connection to the given URL.
   * Resolves when 'open' fires; rejects on 'error'.
   */
  function openWebSocket(wsUrl: string): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      socket.on('open', () => resolve(socket));
      socket.on('error', (err: Error) => reject(err));
    });
  }

  /**
   * Sends a CDP command and returns a promise that resolves with the result
   * or rejects on error/timeout.
   *
   * Note: This requires the caller to have already set up a message listener
   * on `ws` before calling (handled inside takeSnapshot via the event loop).
   */
  function sendCommand(
    socket: WebSocket,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const id = nextCmdId++;

      const cleanup = () => {
        socket.off('message', messageHandler);
        socket.off('error', errorHandler);
      };

      const messageHandler = (raw: WebSocket.RawData) => {
        let msg: CdpMessage;
        try {
          msg = JSON.parse(raw.toString()) as CdpMessage;
        } catch {
          return;
        }
        if (msg.id !== id) return;

        cleanup();
        if (msg.error != null) {
          reject(new Error(`CDP error for "${method}": ${msg.error.message}`));
        } else {
          resolve(msg.result);
        }
      };

      const errorHandler = (err: Error) => {
        cleanup();
        reject(err);
      };

      socket.on('message', messageHandler);
      socket.on('error', errorHandler);
      socket.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Connects to the inspector endpoint.
   *
   * GETs `{inspectorUrl}/json/list` to obtain the webSocketDebuggerUrl, then
   * opens a WebSocket connection.  Retries with exponential backoff up to
   * MAX_RETRIES attempts.  Throws if all retries are exhausted.
   */
  const connect = async (inspectorUrl: string): Promise<void> => {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1000, 2000, 4000, 8000, 16000 ms.
        const delayMs = BACKOFF_BASE_MS * 2 ** (attempt - 1);
        // biome-ignore lint/performance/noAwaitInLoops: intentional sequential retry delay
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const wsUrl = await fetchDebuggerUrl(inspectorUrl);
        ws = await openWebSocket(wsUrl);
        return; // Success
      } catch (err) {
        lastError = err;
        // Clean up any partially-opened socket before retrying
        if (ws != null) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          ws = null;
        }
      }
    }

    throw new Error(
      `Failed to connect to inspector at ${inspectorUrl} after ${MAX_RETRIES} attempts. Last error: ${String(lastError)}`,
    );
  };

  /**
   * Takes a heap snapshot and writes it to `outputPath` as a .heapsnapshot file.
   *
   * Sends HeapProfiler.enable followed by HeapProfiler.takeHeapSnapshot, then
   * collects all HeapProfiler.addHeapSnapshotChunk events until
   * HeapProfiler.reportHeapSnapshotProgress reports `finished: true`.
   *
   * Closes the connection on failure (Req 1.5).
   */
  const takeSnapshot = async (outputPath: string): Promise<void> => {
    if (ws == null) {
      throw new Error('Not connected. Call connect() before takeSnapshot().');
    }
    const socket = ws;

    // Ensure the output directory exists
    const outDir = path.dirname(outputPath);
    fs.mkdirSync(outDir, { recursive: true });

    try {
      // Enable HeapProfiler domain
      await sendCommand(socket, 'HeapProfiler.enable');

      // Collect snapshot chunks from events while the command is in-flight
      const chunks: string[] = [];

      await new Promise<void>((resolve, reject) => {
        const id = nextCmdId++;

        const messageHandler = (raw: WebSocket.RawData) => {
          let msg: CdpMessage;
          try {
            msg = JSON.parse(raw.toString()) as CdpMessage;
          } catch {
            return;
          }

          if (
            msg.method === 'HeapProfiler.addHeapSnapshotChunk' &&
            msg.params != null
          ) {
            chunks.push(msg.params.chunk as string);
          } else if (
            msg.method === 'HeapProfiler.reportHeapSnapshotProgress' &&
            msg.params != null
          ) {
            if (msg.params.finished === true) {
              // Snapshot data collection complete; command result arrives separately but
              // we can resolve as soon as 'finished' is signalled.
              socket.off('message', messageHandler);
              resolve();
            }
          } else if (msg.id === id) {
            // Command result arrived (may come before or after 'finished' event)
            if (msg.error != null) {
              socket.off('message', messageHandler);
              reject(
                new Error(
                  `HeapProfiler.takeHeapSnapshot failed: ${msg.error.message}`,
                ),
              );
            }
            // If no 'finished' event yet, keep waiting; resolve happens in the progress handler.
          }
        };

        socket.on('message', messageHandler);

        // Send the snapshot command
        socket.send(
          JSON.stringify({
            id,
            method: 'HeapProfiler.takeHeapSnapshot',
            params: { reportProgress: true },
          }),
        );

        // Guard against errors on the socket itself
        socket.once('error', (err: Error) => {
          socket.off('message', messageHandler);
          reject(err);
        });
      });

      // Write all collected chunks to the output file
      fs.writeFileSync(outputPath, chunks.join(''), 'utf8');
    } catch (err) {
      // Req 1.5: ensure connection is closed on failure
      await close();
      throw err;
    }
  };

  /**
   * Closes the WebSocket connection.
   * Safe to call even if not connected.
   */
  const close = (): Promise<void> => {
    if (ws != null) {
      ws.close();
      ws = null;
    }
    return Promise.resolve();
  };

  return { connect, takeSnapshot, close };
}
