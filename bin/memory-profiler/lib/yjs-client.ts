/**
 * YjsClient
 *
 * A minimal y-websocket client that can open a WebSocket connection to
 * GROWI's Yjs endpoint, perform a clean close (normal WS handshake), or
 * abort the connection abruptly (equivalent to socket.destroy() / TCP RST).
 *
 * The "abort" path simulates a NAT half-close / abrupt client disappearance,
 * which is a key scenario for verifying whether the server retains Y.Doc
 * instances indefinitely (L3 in the memory-leak investigation).
 *
 * GROWI's Yjs WebSocket endpoint path:
 *   /yjs/{pageId}   (YJS_WEBSOCKET_BASE_PATH = '/yjs')
 *
 * See: apps/app/src/server/service/yjs/yjs.ts
 */

import WebSocket from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YjsSession {
  /**
   * Opens the WebSocket connection to the Yjs endpoint.
   * Resolves when the connection is established (the 'open' event fires).
   */
  connect(): Promise<void>;

  /**
   * Performs a clean WS close handshake (CLOSE frame exchange).
   * Resolves when the connection is fully closed.
   */
  cleanClose(): Promise<void>;

  /**
   * Aborts the connection immediately without sending a CLOSE frame.
   * Equivalent to socket.destroy() — simulates an abrupt client disconnect.
   */
  abort(): void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base path for GROWI's Yjs WebSocket endpoint. */
const YJS_BASE_PATH = '/yjs';

/** Timeout in milliseconds for the initial connection open event. */
const CONNECT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new YjsSession for the given document ID.
 *
 * @param wsBaseUrl - The WebSocket base URL of the GROWI server,
 *                    e.g. "ws://localhost:3000".
 * @param pageId    - The GROWI page ID used as the Yjs document name.
 * @param cookie    - Optional session cookie to send with the upgrade request.
 */
export function createYjsSession(
  wsBaseUrl: string,
  pageId: string,
  cookie?: string,
): YjsSession {
  const url = `${wsBaseUrl}${YJS_BASE_PATH}/${pageId}`;

  let ws: WebSocket | null = null;

  /**
   * Opens a WebSocket connection and resolves when the 'open' event fires.
   * Rejects on 'error' or if the connection times out.
   */
  const connect = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (cookie != null && cookie.length > 0) {
        headers.Cookie = cookie;
      }

      const socket = new WebSocket(url, { headers });
      ws = socket;

      const timer = setTimeout(() => {
        reject(new Error(`YjsSession: connection to ${url} timed out`));
        socket.terminate();
      }, CONNECT_TIMEOUT_MS);

      socket.once('open', () => {
        clearTimeout(timer);
        resolve();
      });

      socket.once('error', (err: Error) => {
        clearTimeout(timer);
        ws = null;
        reject(err);
      });
    });
  };

  /**
   * Sends a normal WebSocket CLOSE frame and waits for the server's
   * corresponding CLOSE frame (the 'close' event).
   */
  const cleanClose = (): Promise<void> => {
    if (ws == null) {
      return Promise.resolve();
    }

    const socket = ws;
    ws = null;

    return new Promise<void>((resolve) => {
      socket.once('close', () => resolve());
      socket.close(1000, 'profiling-clean-close');
    });
  };

  /**
   * Terminates the WebSocket connection immediately without a CLOSE handshake.
   *
   * ws.terminate() calls socket.destroy() on the underlying TCP socket,
   * which is equivalent to an abrupt client disconnect / NAT half-close.
   */
  const abort = (): void => {
    if (ws != null) {
      ws.terminate();
      ws = null;
    }
  };

  return { connect, cleanClose, abort };
}
