import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVaultAdminRouter } from './vault-admin';

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so vi.mock() hoisting applies.
// ---------------------------------------------------------------------------

vi.mock('../services/vault-namespace-mapper', () => ({
  vaultNamespaceMapper: {},
}));

vi.mock('../services/vault-bootstrapper', () => ({
  vaultBootstrapperFactory: vi.fn(() => mockBootstrapper),
}));

vi.mock('../services/vault-settings-service', () => ({
  vaultSettingsService: {
    getSettings: vi.fn().mockResolvedValue({
      enabled: true,
      managerEndpoint: 'http://vault-manager:3100',
      managerInternalSecret: 'test-secret',
    }),
  },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: {},
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock admin/login required factories — these require a real Crowi instance and
// MongoDB connection which are unavailable in unit tests. The router under test
// is constructed without a crowi argument so these factories are never called,
// but they must be resolvable at import time.
vi.mock('~/server/middlewares/admin-required', () => ({
  default: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

// ---------------------------------------------------------------------------
// Stub implementations
// ---------------------------------------------------------------------------

const mockBootstrapper = {
  getStatus: vi.fn(),
  start: vi.fn(),
  wipeAndRebootstrap: vi.fn(),
  initOnStartup: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getResilienceStatus: vi.fn(),
  abortAutoRetry: vi.fn(),
};

const mockManagerClient = {
  getStorageStats: vi.fn(),
  composeView: vi.fn(),
  proxyGitRequest: vi.fn(),
};

// ---------------------------------------------------------------------------
// Import mocked singletons so tests can reconfigure them.
// ---------------------------------------------------------------------------

import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';

import { vaultSettingsService } from '../services/vault-settings-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Express app with the vault admin router mounted. */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/_api/admin/vault',
    createVaultAdminRouter({
      bootstrapper: mockBootstrapper,
      managerClient: mockManagerClient,
      // No crowi → auth middleware is skipped in tests.
    }),
  );
  return app;
}

/** A complete BootstrapStatus fixture. */
const doneStatus = {
  state: 'done' as const,
  processed: 1000,
  totalEstimated: 1000,
  cursor: null,
  startedAt: new Date('2024-01-01T00:00:00Z'),
  completedAt: new Date('2024-01-01T01:00:00Z'),
  lastError: null,
};

/** A StorageStatsResponse fixture. */
const storageStatsFixture = {
  namespaceCount: 5,
  totalCommitCount: 1000,
  repoSizeBytes: 512000,
};

/** A ResilienceStatus fixture covering all fields. */
const resilienceStatusFixture = {
  bootstrap: {
    state: 'done' as const,
    processed: 1000,
    totalEstimated: 1000,
    cursor: null,
    startedAt: new Date('2024-01-01T00:00:00Z'),
    completedAt: new Date('2024-01-01T01:00:00Z'),
    lastError: null,
  },
  retry: {
    attemptNo: 2,
    nextAttemptAt: null,
    lastError: null,
    aborted: false,
  },
  drift: {
    lastSweepAt: null,
    lastWatermark: null,
    detectedSinceBoot: 0,
    repairsEmittedSinceBoot: 0,
    lastError: null,
  },
  lastTriggerSource: 'startup' as const,
  forceWarningActive: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultAdminRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // resetAllMocks wipes mockResolvedValue set in the vi.mock factory, so
    // re-arm the vault settings stub with a sensible default for each test.
    vi.mocked(vaultSettingsService.getSettings).mockResolvedValue({
      enabled: true,
      managerEndpoint: 'http://vault-manager:3100',
      managerInternalSecret: 'test-secret',
    });
  });

  // -------------------------------------------------------------------------
  // GET /status
  // -------------------------------------------------------------------------

  describe('GET /status', () => {
    it('returns bootstrap status and storage stats when both succeed', async () => {
      mockBootstrapper.getStatus.mockResolvedValue(doneStatus);
      mockManagerClient.getStorageStats.mockResolvedValue(storageStatsFixture);

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/status');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.bootstrapState).toBe('done');
      expect(res.body.data.processed).toBe(1000);
      expect(res.body.data.totalEstimated).toBe(1000);
      expect(res.body.data.storageStats).toMatchObject({
        namespaceCount: 5,
        totalCommitCount: 1000,
      });
    });

    it('returns storageStats as null when vault-manager call fails', async () => {
      mockBootstrapper.getStatus.mockResolvedValue(doneStatus);
      mockManagerClient.getStorageStats.mockRejectedValue(
        new Error('vault-manager unreachable'),
      );

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/status');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // Bootstrap info is still present.
      expect(res.body.data.bootstrapState).toBe('done');
      // Storage stats gracefully degrade to null.
      expect(res.body.data.storageStats).toBeNull();
    });

    it('returns 500 when getStatus itself throws', async () => {
      mockBootstrapper.getStatus.mockRejectedValue(
        new Error('DB connection error'),
      );

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/status');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // POST /bootstrap — endpoint removed (admin UI Prepare button was equivalent
  // to Wipe and confusing; bootstrap from admin is only via /wipe now).
  // -------------------------------------------------------------------------

  describe('POST /bootstrap (removed)', () => {
    it('returns 404 (endpoint no longer exists)', async () => {
      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/bootstrap');
      expect(res.status).toBe(404);
    });

    it('does not call bootstrapper.start when /bootstrap is hit', async () => {
      const app = buildApp();
      await request(app).post('/_api/admin/vault/bootstrap');
      expect(mockBootstrapper.start).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // PUT /enabled — endpoint removed (VAULT_ENABLED is env-only, no runtime toggle)
  // -------------------------------------------------------------------------

  describe('PUT /enabled (removed)', () => {
    it('returns 404 (endpoint no longer exists)', async () => {
      const app = buildApp();
      const res = await request(app)
        .put('/_api/admin/vault/enabled')
        .send({ enabled: true });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /wipe — kill switch (admin-force-wipe)
  // -------------------------------------------------------------------------

  describe('POST /wipe', () => {
    it('invokes wipeAndRebootstrap with admin-force-wipe and returns 202', async () => {
      mockBootstrapper.wipeAndRebootstrap.mockImplementation(
        async (opts: { triggerSource: string; onRunning?: () => void }) => {
          // Production behavior: resilience layer eventually fires
          // onRunning. Stub it synchronously so the test does not hang.
          opts.onRunning?.();
        },
      );

      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/wipe');

      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(mockBootstrapper.wipeAndRebootstrap).toHaveBeenCalledWith(
        expect.objectContaining({ triggerSource: 'admin-force-wipe' }),
      );
    });

    it('does NOT return 202 until onRunning has fired', async () => {
      // The route must observe the onRunning callback (state='running'
      // committed in DB) before responding — otherwise SWR revalidate after
      // 202 would race the state transition and the UI would briefly see
      // state='done' even though a wipe is in progress.
      let triggerOnRunning: (() => void) | undefined;
      mockBootstrapper.wipeAndRebootstrap.mockImplementation(
        (opts: { triggerSource: string; onRunning?: () => void }) => {
          return new Promise<void>(() => {
            // Full bootstrap promise never resolves — simulates a long
            // pipeline. The route MUST rely on onRunning to decide when to
            // respond, not on this outer promise.
            triggerOnRunning = () => opts.onRunning?.();
          });
        },
      );

      const app = buildApp();
      // Track whether the response has arrived without awaiting on the
      // request — `request(app).post(...).then(...)` resolves only when the
      // server actually sends the response.
      let responseStatus: number | undefined;
      const responsePromise = request(app)
        .post('/_api/admin/vault/wipe')
        .then((res) => {
          responseStatus = res.status;
          return res;
        });

      // Give the route a tick to call wipeAndRebootstrap and start awaiting.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockBootstrapper.wipeAndRebootstrap).toHaveBeenCalledTimes(1);
      // Before onRunning fires, the response must NOT have been sent.
      expect(responseStatus).toBeUndefined();

      // Fire onRunning — the route should now respond.
      triggerOnRunning?.();

      const res = await responsePromise;
      expect(res.status).toBe(202);
    });

    it('returns 500 when wipeAndRebootstrap rejects before onRunning fires', async () => {
      mockBootstrapper.wipeAndRebootstrap.mockImplementation(() =>
        Promise.reject(new Error('startup failure')),
      );

      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/wipe');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // GET /resilience-status
  // -------------------------------------------------------------------------

  describe('GET /resilience-status', () => {
    it('applies auth middleware when crowi is provided', async () => {
      mockBootstrapper.getResilienceStatus.mockResolvedValue(
        resilienceStatusFixture,
      );

      const mockCrowi = {};
      const app = express();
      app.use(express.json());
      app.use(
        '/_api/admin/vault',
        createVaultAdminRouter({
          bootstrapper: mockBootstrapper,
          managerClient: mockManagerClient,
          crowi: mockCrowi,
        }),
      );

      await request(app).get('/_api/admin/vault/resilience-status');

      // Both middleware factories must have been called with the crowi instance.
      expect(loginRequiredFactory).toHaveBeenCalledWith(mockCrowi);
      expect(adminRequiredFactory).toHaveBeenCalledWith(mockCrowi);
    });

    it('returns 200 with full ResilienceStatus on success', async () => {
      mockBootstrapper.getResilienceStatus.mockResolvedValue(
        resilienceStatusFixture,
      );

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/resilience-status');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.bootstrap.state).toBe('done');
      expect(res.body.data.bootstrap.processed).toBe(1000);
      expect(res.body.data.retry).toMatchObject({ attemptNo: 2 });
      expect(res.body.data.drift).not.toBeNull();
      expect(res.body.data.lastTriggerSource).toBe('startup');
      expect(res.body.data.forceWarningActive).toBe(false);
    });

    it('returns 500 when getResilienceStatus throws', async () => {
      mockBootstrapper.getResilienceStatus.mockRejectedValue(
        new Error('DB connection error'),
      );

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/resilience-status');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // POST /retry/abort
  // -------------------------------------------------------------------------

  describe('POST /retry/abort', () => {
    it('applies auth middleware when crowi is provided', async () => {
      mockBootstrapper.getStatus.mockResolvedValue({
        ...doneStatus,
        state: 'failed',
      });
      mockBootstrapper.abortAutoRetry.mockResolvedValue(undefined);

      const mockCrowi = {};
      const app = express();
      app.use(express.json());
      app.use(
        '/_api/admin/vault',
        createVaultAdminRouter({
          bootstrapper: mockBootstrapper,
          managerClient: mockManagerClient,
          crowi: mockCrowi,
        }),
      );

      await request(app).post('/_api/admin/vault/retry/abort');

      expect(loginRequiredFactory).toHaveBeenCalledWith(mockCrowi);
      expect(adminRequiredFactory).toHaveBeenCalledWith(mockCrowi);
    });

    it('returns 200 with aborted:true when bootstrap is in failed state', async () => {
      mockBootstrapper.getStatus.mockResolvedValue({
        ...doneStatus,
        state: 'failed',
      });
      mockBootstrapper.abortAutoRetry.mockResolvedValue(undefined);

      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/retry/abort');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toMatchObject({ aborted: true });
      expect(mockBootstrapper.abortAutoRetry).toHaveBeenCalledOnce();
    });

    it('returns 200 with aborted:true when bootstrap is in retrying state', async () => {
      mockBootstrapper.getStatus.mockResolvedValue({
        ...doneStatus,
        state: 'retrying',
      });
      mockBootstrapper.abortAutoRetry.mockResolvedValue(undefined);

      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/retry/abort');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toMatchObject({ aborted: true });
    });

    it('returns 409 when bootstrap is not in a retriable state', async () => {
      mockBootstrapper.getStatus.mockResolvedValue({
        ...doneStatus,
        state: 'idle',
      });

      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/retry/abort');

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toMatch(/cannot abort retry/i);
      // abortAutoRetry must NOT be called when not in a retriable state.
      expect(mockBootstrapper.abortAutoRetry).not.toHaveBeenCalled();
    });

    it('returns 500 when getStatus throws', async () => {
      mockBootstrapper.getStatus.mockRejectedValue(new Error('DB error'));

      const app = buildApp();
      const res = await request(app).post('/_api/admin/vault/retry/abort');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });
});
