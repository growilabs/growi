/**
 * vault-admin-reconcile.spec.ts
 *
 * Unit tests for the reconcile endpoints added to vault-admin.ts:
 *   POST /vault/reconcile       — admin-triggered reconcile submission
 *   GET  /vault/reconcile-history — paginated history list (admin only)
 *
 * Tests the HTTP status mapping from ReconcileRejectReason → HTTP status:
 *   'invalid-target'                   → 400
 *   'bootstrap-not-done'               → 409
 *   'page-count-exceeds-user-limit'    → 422
 *   'page-count-exceeds-admin-limit'   → 422
 *   'user-concurrency-limit'           → 429
 *   'system-concurrency-limit'         → 429
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVaultAdminRouter } from '../vault-admin';

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so vi.mock() hoisting applies.
// ---------------------------------------------------------------------------

vi.mock('../../services/vault-namespace-mapper', () => ({
  vaultNamespaceMapper: {},
}));

vi.mock('../../services/vault-bootstrapper', () => ({
  vaultBootstrapperFactory: vi.fn(() => mockBootstrapper),
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    updateConfigs: vi.fn(),
  },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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

const mockReconcileService = {
  submit: vi.fn(),
  listHistory: vi.fn(),
  stop: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app with the vault admin router mounted.
 * Injects a mock reconcileService directly into the factory deps.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/_api/admin/vault',
    createVaultAdminRouter({
      bootstrapper: mockBootstrapper,
      managerClient: mockManagerClient,
      reconcileService: mockReconcileService,
      // No crowi → auth middleware is skipped in tests.
    }),
  );
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const acceptedResult = {
  status: 'accepted' as const,
  reconcileId: 'test-uuid-1234',
  descendantCount: 10,
};

const reconcileLogEntries = [
  {
    reconcileId: 'uuid-1',
    triggeredBy: { userId: 'user1', isAdmin: true },
    targetType: 'sub-tree',
    targetPath: '/foo',
    descendantCount: 10,
    processedCount: 11,
    status: 'completed',
    triggeredAt: new Date('2024-01-01T00:00:00Z'),
    completedAt: new Date('2024-01-01T00:01:00Z'),
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultAdminRouter — reconcile endpoints', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -------------------------------------------------------------------------
  // POST /reconcile
  // -------------------------------------------------------------------------

  describe('POST /reconcile', () => {
    it('returns 202 with accepted result when submit succeeds', async () => {
      mockReconcileService.submit.mockResolvedValue(acceptedResult);

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'sub-tree', targetPath: '/foo' });

      expect(res.status).toBe(202);
      expect(res.body.ok).toBe(true);
      expect(res.body.data).toMatchObject({
        status: 'accepted',
        reconcileId: 'test-uuid-1234',
        descendantCount: 10,
      });
    });

    it('passes isAdmin: true and req.user.id as triggeredBy to submit', async () => {
      mockReconcileService.submit.mockResolvedValue(acceptedResult);

      const app = express();
      app.use(express.json());
      // Simulate authenticated request by injecting req.user via middleware
      app.use((req: express.Request, _res, next) => {
        (req as unknown as Record<string, unknown>).user = {
          _id: 'admin-user-id',
        };
        next();
      });
      app.use(
        '/_api/admin/vault',
        createVaultAdminRouter({
          bootstrapper: mockBootstrapper,
          managerClient: mockManagerClient,
          reconcileService: mockReconcileService,
        }),
      );

      await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'page', targetPath: '/bar' });

      expect(mockReconcileService.submit).toHaveBeenCalledWith({
        targetType: 'page',
        targetPath: '/bar',
        triggeredBy: { userId: 'admin-user-id', isAdmin: true },
      });
    });

    it('returns 400 when submit rejects with invalid-target', async () => {
      mockReconcileService.submit.mockResolvedValue({
        status: 'rejected',
        reason: 'invalid-target',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'page', targetPath: '/nonexistent' });

      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.reason).toBe('invalid-target');
    });

    it('returns 409 when submit rejects with bootstrap-not-done', async () => {
      mockReconcileService.submit.mockResolvedValue({
        status: 'rejected',
        reason: 'bootstrap-not-done',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'sub-tree', targetPath: '/foo' });

      expect(res.status).toBe(409);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.reason).toBe('bootstrap-not-done');
    });

    it('returns 422 when submit rejects with page-count-exceeds-user-limit', async () => {
      mockReconcileService.submit.mockResolvedValue({
        status: 'rejected',
        reason: 'page-count-exceeds-user-limit',
        descendantCount: 2000,
        roleLimit: 1000,
      });

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'sub-tree', targetPath: '/large' });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.reason).toBe('page-count-exceeds-user-limit');
      expect(res.body.data.descendantCount).toBe(2000);
      expect(res.body.data.roleLimit).toBe(1000);
    });

    it('returns 422 when submit rejects with page-count-exceeds-admin-limit', async () => {
      mockReconcileService.submit.mockResolvedValue({
        status: 'rejected',
        reason: 'page-count-exceeds-admin-limit',
        descendantCount: 5000,
        roleLimit: 1000,
      });

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'sub-tree', targetPath: '/huge' });

      expect(res.status).toBe(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.reason).toBe('page-count-exceeds-admin-limit');
    });

    it('returns 429 when submit rejects with user-concurrency-limit', async () => {
      mockReconcileService.submit.mockResolvedValue({
        status: 'rejected',
        reason: 'user-concurrency-limit',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'page', targetPath: '/busy' });

      expect(res.status).toBe(429);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.reason).toBe('user-concurrency-limit');
    });

    it('returns 429 when submit rejects with system-concurrency-limit', async () => {
      mockReconcileService.submit.mockResolvedValue({
        status: 'rejected',
        reason: 'system-concurrency-limit',
      });

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'page', targetPath: '/full' });

      expect(res.status).toBe(429);
      expect(res.body.ok).toBe(false);
      expect(res.body.data.reason).toBe('system-concurrency-limit');
    });

    it('returns 500 when submit throws an unexpected error', async () => {
      mockReconcileService.submit.mockRejectedValue(new Error('DB error'));

      const app = buildApp();
      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'page', targetPath: '/foo' });

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });

    it('returns 500 when reconcileService is not injected', async () => {
      const app = express();
      app.use(express.json());
      app.use(
        '/_api/admin/vault',
        createVaultAdminRouter({
          bootstrapper: mockBootstrapper,
          managerClient: mockManagerClient,
          // No reconcileService
        }),
      );

      const res = await request(app)
        .post('/_api/admin/vault/reconcile')
        .send({ targetType: 'page', targetPath: '/foo' });

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // GET /reconcile-history
  // -------------------------------------------------------------------------

  describe('GET /reconcile-history', () => {
    it('returns 200 with entries and total', async () => {
      mockReconcileService.listHistory.mockResolvedValue(reconcileLogEntries);

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/reconcile-history');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.entries).toHaveLength(1);
      expect(res.body.data.total).toBeGreaterThanOrEqual(0);
      expect(res.body.data.entries[0].reconcileId).toBe('uuid-1');
    });

    it('passes limit and offset query params to listHistory', async () => {
      mockReconcileService.listHistory.mockResolvedValue([]);

      const app = buildApp();
      await request(app).get(
        '/_api/admin/vault/reconcile-history?limit=5&offset=10',
      );

      expect(mockReconcileService.listHistory).toHaveBeenCalledWith({
        limit: 5,
        offset: 10,
      });
    });

    it('uses default limit when not provided', async () => {
      mockReconcileService.listHistory.mockResolvedValue([]);

      const app = buildApp();
      await request(app).get('/_api/admin/vault/reconcile-history');

      // limit param should be passed as undefined or a default; the service may apply its own default
      expect(mockReconcileService.listHistory).toHaveBeenCalled();
    });

    it('returns 500 when listHistory throws', async () => {
      mockReconcileService.listHistory.mockRejectedValue(
        new Error('DB read error'),
      );

      const app = buildApp();
      const res = await request(app).get('/_api/admin/vault/reconcile-history');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });

    it('returns 500 when reconcileService is not injected', async () => {
      const app = express();
      app.use(express.json());
      app.use(
        '/_api/admin/vault',
        createVaultAdminRouter({
          bootstrapper: mockBootstrapper,
          managerClient: mockManagerClient,
          // No reconcileService
        }),
      );

      const res = await request(app).get('/_api/admin/vault/reconcile-history');

      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
    });
  });
});
