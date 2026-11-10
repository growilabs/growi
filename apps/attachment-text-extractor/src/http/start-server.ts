import { Server } from 'node:http';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';

import type { AppEnv } from './app-env';

export interface StartedServer {
  /** The port listened on; the one the OS picked when 0 was asked for. */
  readonly port: number;
  close(): Promise<void>;
}

// Set here rather than left to Node's defaults, which have changed between
// releases. requestTimeout must stay above any UPLOAD_TIMEOUT_S, or Node
// answers its own code-less 408 first; a connection that sends no complete
// header block is cut after headersTimeout (both checked every 30 s).
const SERVER_OPTIONS = {
  headersTimeout: 60_000,
  requestTimeout: 300_000,
  keepAliveTimeout: 5_000,
} as const;

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });

/** Listens with the production wiring (main.ts and the tests use the same). */
export const startServer = (
  app: Hono<AppEnv>,
  options: { readonly port: number; readonly hostname: string },
): Promise<StartedServer> =>
  new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: app.fetch,
        port: options.port,
        hostname: options.hostname,
        serverOptions: SERVER_OPTIONS,
      },
      (info) => {
        if (!(server instanceof Server)) {
          reject(new Error('expected an HTTP/1.1 server'));
          return;
        }
        resolve({ port: info.port, close: () => closeServer(server) });
      },
    );
    server.once('error', reject);
    // No "100 Continue" up front: POST /extract sends it once it decides to
    // read the body (a body declared over the cap gets its 413 alone).
    server.on('checkContinue', (request, response) =>
      server.emit('request', request, response),
    );
  });
