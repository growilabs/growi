// The composed app, and the one property that could not be checked while the
// endpoints were being built one file at a time: **every path GROWI signs a
// request to actually stands behind the signature guard.**
//
// Task 8.1's hand-off (a) asked for exactly this, and task 8.4's hand-off says
// how: walk `INBOUND_OP_BY_PATH`, not the app's own route list. A path missing
// from the table (the unsigned pairing submission) is then out of scope by
// construction, with no exception list for anyone to maintain.
//
// **The check is behavioural, not structural.** It sends an unsigned request
// to each path and requires a 401. Nothing inspects Hono's internals or looks
// for a marker on the middleware, so it cannot be satisfied by a route that
// merely *looks* guarded: remove `guard` from any one registration and that
// path answers 400 or 500 (its handler reads a `verifiedBody` that is not
// there) instead of 401.
//
// It also runs against the app `createRoutesApp` builds, never one this file
// assembles: a spec that wires its own app would only be asserting its own
// wiring.
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { REQUIRES_INBOUND_REACHABILITY } from '../capabilities/index.js';
import type { InstallationStore, PlatformFacade } from '../platform/index.js';
import type { PlatformAppConfig } from '../types/index.js';
import { createRoutesApp, type RoutesAppDeps } from './app.js';
import { HEALTH_PATH } from './health-routes.js';
import { installCallbackPath } from './install-routes.js';
import type { KeyRoutesDeps } from './key-routes.js';
import type { NotificationRoutesDeps } from './notification-routes.js';
import {
  PAIRING_SUBMIT_PATH,
  type PairingRoutesDeps,
} from './pairing-routes.js';
import type { ReadRoutesDeps } from './read-routes.js';
import { INBOUND_OP_BY_PATH } from './signature-guard.js';
import { webhookPath } from './webhook-routes.js';

const APP_CONFIG: PlatformAppConfig = {
  stateConnectionString: 'postgres://unused',
};

const appDeps = (overrides: Partial<RoutesAppDeps> = {}): RoutesAppDeps => ({
  notification: mock<NotificationRoutesDeps>(),
  key: mock<KeyRoutesDeps>(),
  read: mock<ReadRoutesDeps>(),
  pairing: mock<PairingRoutesDeps>(),
  install: {
    appConfig: APP_CONFIG,
    installations: mock<InstallationStore>(),
    onInstallFailed: vi.fn(),
    exchanges: {
      slack: {
        exchange: async () => ({
          ok: true,
          installation: {
            platform: 'slack',
            workspaceId: 'W1',
            workspaceName: 'Acme',
            credentials: {},
          },
        }),
      },
    },
  },
  webhook: {
    platform: mock<Pick<PlatformFacade, 'webhookHandler'>>({
      webhookHandler: () => async () => new Response(null, { status: 200 }),
    }),
  },
  reachability: REQUIRES_INBOUND_REACHABILITY,
  ...overrides,
});

const signedPaths = [...INBOUND_OP_BY_PATH.keys()];

describe('every path GROWI signs a request to is behind the guard', () => {
  it('has paths to check at all', () => {
    // Without this, an empty table would make the sweep below pass vacuously
    // -- the same protection `architecture.spec.ts` gives its own walks.
    expect(signedPaths.length).toBeGreaterThan(0);
  });

  it.each(signedPaths)('refuses an unsigned request to %s', async (path) => {
    const app = createRoutesApp(appDeps());

    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relationId: 'r1', op: 'notification' }),
    });

    expect(response.status).toBe(401);
  });

  it('refuses an unsigned request that carries no body either', async () => {
    const app = createRoutesApp(appDeps());

    const statuses = await Promise.all(
      signedPaths.map(
        async (path) => (await app.request(path, { method: 'POST' })).status,
      ),
    );

    expect(statuses).toEqual(signedPaths.map(() => 401));
  });
});

describe('the endpoints that are deliberately not behind the guard', () => {
  it('serves the pairing submission, which carries no signature at all', async () => {
    const app = createRoutesApp(appDeps());

    const response = await app.request(PAIRING_SUBMIT_PATH, {
      method: 'POST',
      body: 'not json',
    });

    // 400 (the body is not a submission), never the guard's 401.
    expect(response.status).toBe(400);
    expect(INBOUND_OP_BY_PATH.has(PAIRING_SUBMIT_PATH)).toBe(false);
  });

  it('completes an OAuth callback', async () => {
    const app = createRoutesApp(appDeps());

    const response = await app.request(
      `${installCallbackPath('slack')}?code=the-code`,
    );

    expect(response.status).toBe(200);
  });

  it("takes the inbound service's webhook", async () => {
    const app = createRoutesApp(appDeps());

    const response = await app.request(webhookPath('teams'), {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(200);
  });

  it('answers the health check', async () => {
    const app = createRoutesApp(appDeps());

    expect((await app.request(HEALTH_PATH)).status).toBe(200);
  });

  it('actually serves every path the health check tells the operator to open', async () => {
    // The operator writes a firewall rule from `inboundExposure`. A path
    // advertised there that nothing answers would have them open a hole for an
    // endpoint that does not exist -- and the reverse, an open route health
    // says nothing about, leaves a hole nobody knows to narrow. One
    // `reachability` field on `RoutesAppDeps` is what makes the two agree;
    // this is that agreement checked from outside.
    const app = createRoutesApp(appDeps());

    const health = (await (await app.request(HEALTH_PATH)).json()) as {
      inboundExposure: ReadonlyArray<{ path: string }>;
    };
    expect(health.inboundExposure.length).toBeGreaterThan(0);

    const statuses = await Promise.all(
      health.inboundExposure.map(
        async ({ path }) =>
          (await app.request(path, { method: 'POST', body: '{}' })).status,
      ),
    );

    expect(statuses).toEqual(health.inboundExposure.map(() => 200));
  });
});
