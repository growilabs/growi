import { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';

import type { AppEnv } from './app-env';

export interface StartedServer {
  /** The port listened on; the one the OS picked when 0 was asked for. */
  readonly port: number;
  /** Stops at once: the connections of the requests in flight are cut. */
  close(): Promise<void>;
  /** Stops listening, then resolves once every request in flight is answered. */
  drain(): Promise<void>;
}

const HEADERS_TIMEOUT_MS = 60_000;
const MIN_REQUEST_TIMEOUT_MS = 300_000;
// Node checks both timeouts only every 30 s.
const REQUEST_TIMEOUT_MARGIN_MS = 30_000;

/**
 * Set here rather than left to Node's defaults, which have changed between
 * releases. A connection that sends no complete header block is cut after
 * headersTimeout. requestTimeout stays above the headers plus the upload
 * deadline, whatever UPLOAD_TIMEOUT_S is: otherwise Node answers its own
 * code-less 408 before the route's `extraction_timeout`.
 */
export const serverTimeouts = (uploadTimeoutS = 0) => ({
  headersTimeout: HEADERS_TIMEOUT_MS,
  requestTimeout: Math.max(
    MIN_REQUEST_TIMEOUT_MS,
    HEADERS_TIMEOUT_MS + uploadTimeoutS * 1000 + REQUEST_TIMEOUT_MARGIN_MS,
  ),
  keepAliveTimeout: 5_000,
});

const closed = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const closeServer = (server: Server): Promise<void> => {
  const done = closed(server);
  server.closeAllConnections();
  return done;
};

// Counts the requests whose answer is not finished, rather than asking Node
// which connections are idle: Node calls a connection that has sent part of a
// header block busy, and stops its own header and request timeouts once the
// server closes, so such a connection would hold a stopping server for good.
// With no request left, every connection still open is cut. Returns the
// drain: stop listening, resolve once no request is left unanswered.
const trackRequests = (server: Server): (() => Promise<void>) => {
  let unanswered = 0;
  let draining = false;
  const cutWhenDone = (): void => {
    if (draining && unanswered === 0) server.closeAllConnections();
  };
  server.on('request', (_request, response) => {
    unanswered++;
    response.once('close', () => {
      unanswered--;
      cutWhenDone();
    });
  });
  return () => {
    draining = true;
    const done = closed(server);
    cutWhenDone();
    return done;
  };
};

/** Listens with the production wiring (the service and the tests use the same). */
export const startServer = (
  app: Hono<AppEnv>,
  options: {
    readonly port: number;
    readonly hostname: string;
    /** UPLOAD_TIMEOUT_S, when the app was built with settings that raise it. */
    readonly uploadTimeoutS?: number;
  },
): Promise<StartedServer> =>
  new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        port: options.port,
        hostname: options.hostname,
        serverOptions: serverTimeouts(options.uploadTimeoutS),
      },
      (info) => {
        if (!(server instanceof Server)) {
          reject(new Error('expected an HTTP/1.1 server'));
          return;
        }
        const drain = trackRequests(server);
        resolve({
          port: info.port,
          close: () => closeServer(server),
          drain,
        });
      },
    );
    server.once('error', reject);
    // No "100 Continue" up front: POST /extract sends it once it decides to
    // read the body (a body declared over the cap gets its 413 alone).
    server.on('checkContinue', (request, response) =>
      server.emit('request', request, response),
    );
  });
