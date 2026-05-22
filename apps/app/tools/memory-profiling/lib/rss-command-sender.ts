/**
 * RssCommandSender
 *
 * Creates a minimal CDP command sender for use with RssTimeSeriesLogger.
 *
 * Opens a separate WebSocket connection to the Node.js inspector endpoint
 * (distinct from the HeapProfiler connection used by CdpSnapshotClient)
 * so that Runtime.evaluate polling does not interfere with heap snapshot
 * acquisition.
 *
 * If the inspector is unreachable or returns no targets, the sender falls
 * back to a no-op that returns empty memory usage, allowing RSS logging to
 * degrade gracefully without aborting the scenario.
 */

import WebSocket from 'ws';

import type { CdpCommandSender } from '../rss-time-series-logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a CdpCommandSender that connects to the inspector's /json/list
 * endpoint and sends CDP commands via a dedicated WebSocket connection.
 *
 * @param inspectorUrl - CDP inspector base URL, e.g. "http://127.0.0.1:9229"
 * @returns A connected CdpCommandSender, or a no-op fallback on connection failure.
 */
export async function createRssCommandSender(
  inspectorUrl: string,
): Promise<CdpCommandSender> {
  let ws: WebSocket | null = null;
  let cmdId = 1;

  try {
    // Fetch the debugger WebSocket URL from the inspector's target list
    const response = await fetch(`${inspectorUrl}/json/list`);
    const targets = (await response.json()) as Array<{
      webSocketDebuggerUrl?: string;
    }>;

    if (targets.length === 0 || targets[0].webSocketDebuggerUrl == null) {
      return buildNoopSender();
    }

    const wsUrl = targets[0].webSocketDebuggerUrl;
    ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      // biome-ignore lint/style/noNonNullAssertion: ws was just assigned above
      ws!.on('open', () => resolve());
      // biome-ignore lint/style/noNonNullAssertion: ws was just assigned above
      ws!.on('error', (err: Error) => reject(err));
    });
  } catch {
    // Connection failed — degrade gracefully
    return buildNoopSender();
  }

  const capturedWs = ws;

  return (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> => {
    return new Promise<unknown>((resolve, reject) => {
      const id = cmdId++;

      const cleanup = () => {
        capturedWs.off('message', messageHandler);
        capturedWs.off('error', errorHandler);
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

      capturedWs.on('message', messageHandler);
      capturedWs.on('error', errorHandler);
      capturedWs.send(JSON.stringify({ id, method, params: params ?? {} }));
    });
  };
}

// ---------------------------------------------------------------------------
// No-op fallback
// ---------------------------------------------------------------------------

/**
 * Returns a no-op sender that always resolves with an empty memory usage
 * result. Used when the inspector endpoint is unreachable.
 */
function buildNoopSender(): CdpCommandSender {
  const emptyMem = JSON.stringify({
    rss: 0,
    heapUsed: 0,
    heapTotal: 0,
    external: 0,
  });
  return async (_method: string) => ({ result: { value: emptyMem } });
}
