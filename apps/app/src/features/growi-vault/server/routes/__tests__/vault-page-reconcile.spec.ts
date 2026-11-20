/**
 * vault-page-reconcile.spec.ts
 *
 * Unit tests for the general-user reconcile endpoint in vault-page.ts:
 *   POST /vault/page/reconcile — user-triggered reconcile submission
 *
 * Tests the HTTP status mapping from ReconcileRejectReason → HTTP status:
 *   'invalid-target'                   → 400
 *   'bootstrap-not-done'               → 409
 *   'page-count-exceeds-user-limit'    → 422
 *   'page-count-exceeds-admin-limit'   → 422
 *   'user-concurrency-limit'           → 429
 *   'system-concurrency-limit'         → 429
 *
 * Also verifies:
 *   - Unauthenticated requests → 401 (middleware blocks)
 *   - isAdmin: false is passed to submit
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVaultPageRouter } from '../vault-page';

// ---------------------------------------------------------------------------
// Module mocks — declared before imports so vi.mock() hoisting applies.
// ---------------------------------------------------------------------------

vi.mock('~/utils/logger', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: vi.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

// ---------------------------------------------------------------------------
// Stub implementations
// ---------------------------------------------------------------------------

const mockReconcileService = {
  submit: vi.fn(),
  listHistory: vi.fn(),
  stop: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express app with the vault page router mounted.
 * Injects a mock reconcileService directly into the factory deps.
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    '/_api/v3/vault',
    createVaultPageRouter({
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
  reconcileId: 'test-uuid-5678',
  descendantCount: 5,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultPageRouter — POST /page/reconcile', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 202 with accepted result when submit succeeds', async () => {
    mockReconcileService.submit.mockResolvedValue(acceptedResult);

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'sub-tree', targetPath: '/my-page' });

    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toMatchObject({
      status: 'accepted',
      reconcileId: 'test-uuid-5678',
      descendantCount: 5,
    });
  });

  it('passes isAdmin: false and req.user._id as triggeredBy to submit', async () => {
    mockReconcileService.submit.mockResolvedValue(acceptedResult);

    const app = express();
    app.use(express.json());
    // Simulate authenticated request by injecting req.user via middleware
    app.use((req: express.Request, _res, next) => {
      (req as unknown as Record<string, unknown>).user = {
        _id: 'regular-user-id',
      };
      next();
    });
    app.use(
      '/_api/v3/vault',
      createVaultPageRouter({
        reconcileService: mockReconcileService,
      }),
    );

    await request(app)
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'page', targetPath: '/my-page' });

    expect(mockReconcileService.submit).toHaveBeenCalledWith({
      targetType: 'page',
      targetPath: '/my-page',
      triggeredBy: { userId: 'regular-user-id', isAdmin: false },
    });
  });

  it('returns 400 when submit rejects with invalid-target', async () => {
    mockReconcileService.submit.mockResolvedValue({
      status: 'rejected',
      reason: 'invalid-target',
    });

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/vault/page/reconcile')
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
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'sub-tree', targetPath: '/my-page' });

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
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'sub-tree', targetPath: '/large-tree' });

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.data.reason).toBe('page-count-exceeds-user-limit');
    expect(res.body.data.descendantCount).toBe(2000);
    expect(res.body.data.roleLimit).toBe(1000);
  });

  it('returns 429 when submit rejects with user-concurrency-limit', async () => {
    mockReconcileService.submit.mockResolvedValue({
      status: 'rejected',
      reason: 'user-concurrency-limit',
    });

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'page', targetPath: '/busy-page' });

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
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'page', targetPath: '/full-system' });

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.data.reason).toBe('system-concurrency-limit');
  });

  it('returns 401 when crowi is provided and loginRequired middleware blocks the request', async () => {
    const loginRequiredMock = await import(
      '~/server/middlewares/login-required'
    );
    vi.mocked(loginRequiredMock.default).mockReturnValueOnce(
      (_req: unknown, res: express.Response, _next: () => void) => {
        res.status(401).json({ ok: false, error: 'Login required' });
      },
    );

    const app = express();
    app.use(express.json());
    app.use(
      '/_api/v3/vault',
      createVaultPageRouter({
        reconcileService: mockReconcileService,
        crowi: {}, // crowi provided → middleware is applied
      }),
    );

    const res = await request(app)
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'page', targetPath: '/my-page' });

    expect(res.status).toBe(401);
    expect(mockReconcileService.submit).not.toHaveBeenCalled();
  });

  it('returns 500 when submit throws an unexpected error', async () => {
    mockReconcileService.submit.mockRejectedValue(new Error('DB error'));

    const app = buildApp();
    const res = await request(app)
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'page', targetPath: '/my-page' });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('returns 500 when reconcileService is not injected', async () => {
    const app = express();
    app.use(express.json());
    app.use(
      '/_api/v3/vault',
      createVaultPageRouter({
        // No reconcileService
      }),
    );

    const res = await request(app)
      .post('/_api/v3/vault/page/reconcile')
      .send({ targetType: 'page', targetPath: '/my-page' });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});
