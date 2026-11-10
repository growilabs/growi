// Two properties this file exists to prove, both of which only hold at the
// point the process is assembled:
//
//  1. **The body cap stands in front of everything.** `signatureGuard` reads
//     the whole body before it can check a signature (it has to -- the
//     signature covers the bytes), and the pairing endpoint carries no
//     signature at all. A cap that ran after either of those would be a cap on
//     what is accepted, not on what is read (Implementation Note 8.4).
//  2. **Shutdown gives things back in an order that does not cut work in
//     half**, and survives the second signal a real kill sequence sends.

import type { ServerType } from '@hono/node-server';
import { mock } from 'vitest-mock-extended';

import { REQUIRES_INBOUND_REACHABILITY } from '../capabilities/index.js';
import type { PrismaClient } from '../db/index.js';
import type {
  ConnectionManager,
  InstallationStore,
  PlatformFacade,
} from '../platform/index.js';
import type { KeyRoutesDeps } from '../routes/index.js';
import {
  INBOUND_OP_BY_PATH,
  type NotificationRoutesDeps,
  PAIRING_SUBMIT_PATH,
  type PairingRoutesDeps,
  type ReadRoutesDeps,
  type RoutesAppDeps,
  type SignatureGuardDeps,
} from '../routes/index.js';
import type { PlatformAppConfig } from '../types/index.js';
import type { ProxyConfig } from './config.js';
import { createProxyApp, createShutdown, startProxy } from './server.js';
import type { Sweeper } from './sweeper.js';

const APP_CONFIG: PlatformAppConfig = {
  stateConnectionString: 'postgres://unused',
};

const signedPath = [...INBOUND_OP_BY_PATH.keys()][0] as string;

const routesDeps = (signature: SignatureGuardDeps): RoutesAppDeps => ({
  notification: mock<NotificationRoutesDeps>({ signature }),
  key: mock<KeyRoutesDeps>({ signature }),
  read: mock<ReadRoutesDeps>({ signature }),
  pairing: mock<PairingRoutesDeps>(),
  install: {
    appConfig: APP_CONFIG,
    installations: mock<InstallationStore>(),
    onInstallFailed: vi.fn(),
    exchanges: {},
  },
  webhook: {
    platform: mock<Pick<PlatformFacade, 'webhookHandler'>>({
      webhookHandler: () => async () => new Response(null, { status: 200 }),
    }),
  },
  reachability: REQUIRES_INBOUND_REACHABILITY,
});

const oversized = (bytes: number): string => 'x'.repeat(bytes);

describe('createProxyApp', () => {
  it('refuses an oversized body before the signature guard reads it', async () => {
    const signature = mock<SignatureGuardDeps>();
    const app = createProxyApp(routesDeps(signature), 1024);

    const response = await app.request(signedPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversized(4096),
    });

    expect(response.status).toBe(413);
    // The discriminating assertion: a 413 alone would also be answered by a cap
    // that ran after the guard had already held the body in memory.
    expect(signature.resolvePublicKey).not.toHaveBeenCalled();
    expect(signature.recordFailure).not.toHaveBeenCalled();
  });

  it('refuses an oversized body on the unsigned pairing endpoint, the one entrance with nothing else in front of it', async () => {
    const app = createProxyApp(routesDeps(mock<SignatureGuardDeps>()), 1024);

    const response = await app.request(PAIRING_SUBMIT_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: oversized(4096),
    });

    expect(response.status).toBe(413);
  });

  it('serves a body within the cap through to the endpoint behind it', async () => {
    const signature = mock<SignatureGuardDeps>();
    signature.resolvePublicKey.mockResolvedValue(null);
    const app = createProxyApp(routesDeps(signature), 1024);

    const response = await app.request(signedPath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relationId: 'r1' }),
    });

    // Refused for want of a signature, which is the guard answering -- so the
    // request reached it rather than being stopped by the cap.
    expect(response.status).toBe(401);
  });

  it('serves the endpoints whether or not any chat service is configured', async () => {
    const app = createProxyApp(routesDeps(mock<SignatureGuardDeps>()), 1024);

    expect((await app.request('/health')).status).toBe(200);
  });
});

describe('createShutdown', () => {
  it('stops taking requests before it gives the connections and storage back', async () => {
    const order: string[] = [];
    const shutdown = createShutdown({
      closeHttp: () => {
        order.push('http');
        return Promise.resolve();
      },
      shutdownDependencies: () => {
        order.push('dependencies');
        return Promise.resolve();
      },
    });

    await shutdown();

    expect(order).toEqual(['http', 'dependencies']);
  });

  it('does nothing the second time, because a kill sequence sends more than one signal', async () => {
    const closeHttp = vi.fn(() => Promise.resolve());
    const shutdownDependencies = vi.fn(() => Promise.resolve());
    const shutdown = createShutdown({ closeHttp, shutdownDependencies });

    await Promise.all([shutdown(), shutdown()]);
    await shutdown();

    expect(closeHttp).toHaveBeenCalledTimes(1);
    expect(shutdownDependencies).toHaveBeenCalledTimes(1);
  });

  it('stops waiting for requests that will not finish, rather than never exiting', async () => {
    vi.useFakeTimers();
    try {
      const shutdownDependencies = vi.fn(() => Promise.resolve());
      const shutdown = createShutdown({
        // A request that never finishes: the listener never closes.
        closeHttp: () => new Promise<void>(() => {}),
        shutdownDependencies,
        graceMs: 5_000,
      });

      const finished = shutdown();
      await vi.advanceTimersByTimeAsync(5_000);
      await finished;

      expect(shutdownDependencies).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startProxy', () => {
  const config = (): ProxyConfig => ({
    platformApp: APP_CONFIG,
    closedNetwork: { allowList: [], trustedCaCertsFor: () => [] },
    cipher: { encrypt: (value) => value, decrypt: (value) => value },
    databaseUrl: 'postgresql://proxy@postgres:5432/proxy',
    http: { port: 8123, bodyLimitBytes: 1024 },
    mattermostInstallations: [],
  });

  const overrides = () => {
    // One array for the whole lifecycle: asserting each call happened would
    // pass on an order that leaves a sweep running against a connection that
    // is already being torn down.
    const lifecycle: string[] = [];
    const connections = mock<ConnectionManager>();
    connections.start.mockImplementation(() => {
      lifecycle.push('connections.start');
      return Promise.resolve();
    });
    const facade = mock<PlatformFacade>();
    facade.connections.mockReturnValue(connections);
    facade.shutdown.mockImplementation(() => {
      lifecycle.push('facade.shutdown');
      return Promise.resolve();
    });
    const sweeper = mock<Sweeper>();
    sweeper.start.mockImplementation(() => {
      lifecycle.push('sweeper.start');
    });
    sweeper.stop.mockImplementation(() => {
      lifecycle.push('sweeper.stop');
      return Promise.resolve();
    });
    const close = vi.fn((cb?: (error?: Error) => void) => cb?.());
    const listen = vi.fn(() => ({ close }) as unknown as ServerType);
    return {
      connections,
      sweeper,
      lifecycle,
      close,
      listen,
      startOverrides: {
        listen,
        createDb: () => mock<PrismaClient>(),
        createFacade: () => Promise.resolve(facade),
        createSweeper: () => sweeper,
        reporters: { reportOperationalFailure: vi.fn() },
      },
    };
  };

  it('opens the HTTP listener on the configured port, whichever chat services are configured', async () => {
    const { listen, startOverrides } = overrides();

    await startProxy(config(), startOverrides);

    expect(listen).toHaveBeenCalledWith(expect.anything(), 8123);
  });

  it('starts reconciling the chat connections once everything it needs is built', async () => {
    const { connections, startOverrides } = overrides();

    await startProxy(config(), startOverrides);

    expect(connections.start).toHaveBeenCalled();
  });

  it('closes the listener and gives the connections back when it is stopped', async () => {
    const { connections, close, startOverrides } = overrides();

    const proxy = await startProxy(config(), startOverrides);
    await proxy.stop();

    expect(close).toHaveBeenCalled();
    expect(proxy.dependencies.facade.shutdown).toHaveBeenCalled();
    expect(connections.start).toHaveBeenCalledTimes(1);
  });

  it('runs the periodic work through the whole lifecycle, started after the connections and stopped before them', async () => {
    const { lifecycle, startOverrides } = overrides();

    const proxy = await startProxy(config(), startOverrides);
    await proxy.stop();

    // Started last: a cycle re-taking a channel inventory needs the chat
    // connections it asks through. Stopped first: a cycle firing into a
    // facade that is already shutting down would reach a state connection
    // mid-teardown, and would hold the sweep lock while doing it.
    expect(lifecycle).toEqual([
      'connections.start',
      'sweeper.start',
      'sweeper.stop',
      'facade.shutdown',
    ]);
  });

  it('stops the periodic work even when it was never started as far as the caller knows', async () => {
    const { sweeper, startOverrides } = overrides();

    const proxy = await startProxy(config(), startOverrides);
    await proxy.stop();
    await proxy.stop();

    // `stop()` is idempotent, so the schedule is not taken down twice.
    expect(sweeper.stop).toHaveBeenCalledTimes(1);
  });
});
