// Binding an arbitrary free port, and finding out afterwards which one it was.
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// Two facts shape this file:
//
//  - `RunningProxy.port` echoes back `config.http.port` rather than the port
//    that was bound, so asking for port 0 leaves a caller holding `0` and the
//    fake GROWI with nowhere to call. Picking a number up front instead --
//    bind, close, reuse -- leaves a window in which another process takes it,
//    which is the flake this avoids.
//  - **A server is not bound the instant `serve()` returns.** `address()`
//    answers `null` until the `listening` event fires, so every way of reading
//    the address here waits for it. Reading it too early is how a harness ends
//    up making requests to port 0 and reporting "connection refused" from a
//    place nowhere near the mistake.

import type { AddressInfo } from 'node:net';
import { type ServerType, serve } from '@hono/node-server';
import type { Hono } from 'hono';

import type { StartProxyOverrides } from '../runtime/index.js';

/** The address a harness binds to. Never a public interface. */
export const LOOPBACK = '127.0.0.1';

/** Resolves once the server is bound, with the address it was given. */
export const whenListening = (server: ServerType): Promise<AddressInfo> =>
  new Promise<AddressInfo>((resolve, reject) => {
    const settle = () => {
      const address = server.address();
      if (address == null || typeof address !== 'object') {
        reject(new Error('the server reported no address once it was bound'));
        return;
      }
      resolve(address);
    };

    const address = server.address();
    if (address != null && typeof address === 'object') {
      resolve(address);
      return;
    }
    server.once('listening', settle);
    server.once('error', reject);
  });

/** Binds a free port on the loopback address and answers where it landed. */
export const serveOnFreePort = async (
  app: Hono,
): Promise<{ readonly server: ServerType; readonly baseUrl: string }> => {
  const server = serve({ fetch: app.fetch, hostname: LOOPBACK, port: 0 });
  const address = await whenListening(server);
  return { server, baseUrl: `http://${LOOPBACK}:${address.port}` };
};

export interface FreePortListener {
  /** Hand this to `startProxy` as its `listen` override. */
  readonly listen: NonNullable<StartProxyOverrides['listen']>;
  /**
   * Where the instance is reachable, once it is bound.
   *
   * Asynchronous because binding is: a synchronous reader would have to be
   * called at exactly the right moment, and being called early would produce a
   * URL naming port 0 rather than an error saying what went wrong.
   */
  readonly baseUrl: () => Promise<string>;
}

export const listenOnFreePort = (): FreePortListener => {
  let bound: ServerType | null = null;

  return {
    listen: (app: Hono) => {
      bound = serve({ fetch: app.fetch, hostname: LOOPBACK, port: 0 });
      return bound;
    },
    baseUrl: async () => {
      if (bound == null) {
        throw new Error(
          'this listener has not bound a port yet; start the proxy before reading its address',
        );
      }
      const address = await whenListening(bound);
      return `http://${LOOPBACK}:${address.port}`;
    },
  };
};
