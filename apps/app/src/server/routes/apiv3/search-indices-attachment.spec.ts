/**
 * Tests for the `includeAttachments` extension on PUT /_api/v3/search/indices.
 *
 * Covers task 8.6 boundary:
 *  1. includeAttachments=false → existing fire-and-forget page rebuild (no batch calls)
 *  2. includeAttachments=true + feature enabled + batch available →
 *       batch.begin, rebuildIndex (awaited), addAllAttachments, batch.end called in order
 *  3. includeAttachments=true + feature disabled → 503
 *  4. includeAttachments=true + batch not registered (task 9.1 pending) → 503
 *  5. includeAttachments=true + batch.begin throws (concurrent rebuild) → 503, batch.end still called
 *  6. includeAttachments=true + addAllAttachments throws → 503, batch.end still called
 *
 * Implementation note: search.js declares `const router = express.Router()` at module scope.
 * To prevent handler accumulation across tests (each `searchRouterFactory(crowi)` call would
 * add another PUT /indices handler to the same singleton router), we use
 * `vi.isolateModules` to get a fresh module instance per test.
 */

import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock calls below are hoisted by Vite before any imports execute.
// search.js creates a fresh express.Router() inside the factory, so each
// searchRouterFactory(crowi) call produces an independent router per test.
import { configManager } from '~/server/service/config-manager';

// search.js uses module.exports — TS sees no default export but CJS interop works at runtime.
// @ts-expect-error: CJS module.exports interop
import searchRouterFactory from './search.js';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted by Vite before any code runs.
// ---------------------------------------------------------------------------

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () =>
    (
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) =>
      next(),
}));

vi.mock('~/server/middlewares/apiv3-form-validator', () => ({
  apiV3FormValidator: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

// Relative path matches the import inside search.js (same directory as this spec)
vi.mock('../../middlewares/add-activity', () => ({
  generateAddActivityMiddleware:
    () =>
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const r = res as unknown as Record<string, unknown>;
      r.locals = {
        ...(r.locals as object),
        activity: { _id: 'test-activity-id' },
      };
      next();
    },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockBatch = {
  begin: ReturnType<typeof vi.fn>;
  addAllAttachments: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

function buildMockBatch(): MockBatch {
  return {
    begin: vi.fn(),
    addAllAttachments: vi.fn().mockResolvedValue(undefined),
    end: vi.fn(),
  };
}

interface CrowiStubOptions {
  isConfigured?: boolean;
  isReachable?: boolean;
  attachmentReindexBatch?: MockBatch | null;
}

function buildCrowiStub(opts: CrowiStubOptions = {}) {
  const {
    isConfigured = true,
    isReachable = true,
    attachmentReindexBatch = null,
  } = opts;
  return {
    searchService: {
      isConfigured,
      isReachable,
      rebuildIndex: vi.fn().mockResolvedValue(undefined),
      normalizeIndices: vi.fn().mockResolvedValue(undefined),
    },
    events: { activity: { emit: vi.fn() } },
    attachmentReindexBatch,
  };
}

/**
 * Builds a minimal express app mounting the search router under /search.
 *
 * search.js creates a fresh express.Router() inside the factory function,
 * so each call to searchRouterFactory(crowi) produces an independent router
 * with no handler bleed-over between tests.
 */
function buildTestApp(crowi: ReturnType<typeof buildCrowiStub>) {
  const app = express();
  app.use(express.json());

  // Attach GROWI-style response helpers
  app.use(
    (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      // biome-ignore lint/suspicious/noExplicitAny: test-only response helper
      (res as any).apiv3 = (data: unknown) => res.status(200).json(data);
      // biome-ignore lint/suspicious/noExplicitAny: test-only response helper
      (res as any).apiv3Err = (err: unknown, status = 400) =>
        res.status(status).json({
          errors: [
            {
              message: (err as Error).message ?? String(err),
              code: (err as { code?: string }).code,
            },
          ],
        });
      next();
    },
  );

  const router = searchRouterFactory(crowi);
  app.use('/search', router);

  return app;
}

/** Sets up configManager.getConfig to report the feature as enabled or disabled. */
function setupFeatureFlag(enabled: boolean) {
  // biome-ignore lint/suspicious/noExplicitAny: test helper — mock returns null for disabled
  vi.mocked(configManager.getConfig).mockImplementation((key: string): any => {
    if (key === 'app:attachmentFullTextSearch:extractorUri')
      return enabled ? 'http://extractor.example.com' : null;
    if (key === 'app:attachmentFullTextSearch:extractorToken')
      return enabled ? 'valid-token' : null;
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PUT /search/indices — includeAttachments extension', () => {
  beforeEach(() => {
    vi.mocked(configManager.getConfig).mockReset();
  });

  // -------------------------------------------------------------------------
  // Test 1: includeAttachments=false → existing behaviour, no batch calls
  // -------------------------------------------------------------------------
  it('1. includeAttachments=false → fire-and-forget page rebuild, no batch calls', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: false });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Operation is successfully requested.');

    // Page rebuild triggered (fire-and-forget — not awaited by the route)
    expect(crowi.searchService.rebuildIndex).toHaveBeenCalledTimes(1);

    // Batch must NOT be touched
    expect(batch.begin).not.toHaveBeenCalled();
    expect(batch.addAllAttachments).not.toHaveBeenCalled();
    expect(batch.end).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 1b: omitting includeAttachments → same as false
  // -------------------------------------------------------------------------
  it('1b. omitting includeAttachments defaults to false (no batch calls)', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild' });

    expect(res.status).toBe(200);
    expect(batch.begin).not.toHaveBeenCalled();
    expect(batch.addAllAttachments).not.toHaveBeenCalled();
    expect(batch.end).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: includeAttachments=true + feature enabled + batch available
  //         → begin → rebuildIndex (awaited) → addAllAttachments → end in order
  // -------------------------------------------------------------------------
  it('2. includeAttachments=true + feature enabled + batch available → full orchestration', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    // Track call order across begin / rebuildIndex / addAllAttachments / end
    const callOrder: string[] = [];
    batch.begin.mockImplementation(() => {
      callOrder.push('begin');
    });
    crowi.searchService.rebuildIndex.mockImplementation(() => {
      callOrder.push('rebuildIndex');
      return Promise.resolve();
    });
    batch.addAllAttachments.mockImplementation(() => {
      callOrder.push('addAllAttachments');
      return Promise.resolve();
    });
    batch.end.mockImplementation(() => {
      callOrder.push('end');
    });

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Operation is successfully processed.');

    // Each method called exactly once
    expect(batch.begin).toHaveBeenCalledTimes(1);
    expect(crowi.searchService.rebuildIndex).toHaveBeenCalledTimes(1);
    expect(batch.addAllAttachments).toHaveBeenCalledTimes(1);
    expect(batch.end).toHaveBeenCalledTimes(1);

    // Call order: begin → rebuildIndex → addAllAttachments → end
    expect(callOrder).toEqual([
      'begin',
      'rebuildIndex',
      'addAllAttachments',
      'end',
    ]);

    // begin receives the tmp index name
    expect(batch.begin).toHaveBeenCalledWith('attachments-tmp');

    // addAllAttachments receives tmp index name + a progress callback
    expect(batch.addAllAttachments).toHaveBeenCalledWith(
      'attachments-tmp',
      expect.any(Function),
    );
  });

  // -------------------------------------------------------------------------
  // Test 3: includeAttachments=true + feature disabled → 503
  // -------------------------------------------------------------------------
  it('3. includeAttachments=true + feature disabled → 503 feature_disabled', async () => {
    setupFeatureFlag(false);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(503);
    expect(res.body.errors[0].code).toBe('feature_disabled');

    // No batch interaction
    expect(batch.begin).not.toHaveBeenCalled();
    expect(batch.addAllAttachments).not.toHaveBeenCalled();
    expect(batch.end).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4: includeAttachments=true + batch not registered (task 9.1 pending) → 503
  // -------------------------------------------------------------------------
  it('4. includeAttachments=true + batch not registered → 503 feature_disabled', async () => {
    setupFeatureFlag(true);
    // attachmentReindexBatch is null — not yet registered (task 9.1)
    const crowi = buildCrowiStub({ attachmentReindexBatch: null });
    const app = buildTestApp(crowi);

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(503);
    expect(res.body.errors[0].code).toBe('feature_disabled');
  });

  // -------------------------------------------------------------------------
  // Test 5: includeAttachments=true + batch.begin throws → 503, end still called
  // -------------------------------------------------------------------------
  it('5. batch.begin throws (concurrent rebuild) → 503 and batch.end is still called', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    const concurrentError = Object.assign(
      new Error('Rebuild already in progress'),
      { status: 409 },
    );
    batch.begin.mockImplementation(() => {
      throw concurrentError;
    });

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(503);

    // begin was called and threw
    expect(batch.begin).toHaveBeenCalledTimes(1);
    // addAllAttachments must NOT have been reached
    expect(batch.addAllAttachments).not.toHaveBeenCalled();
    // end must still be called (try/finally guarantee)
    expect(batch.end).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Test 6: addAllAttachments throws → 503, end still called
  // -------------------------------------------------------------------------
  it('6. addAllAttachments throws → 503 and batch.end is still called', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    batch.addAllAttachments.mockRejectedValue(
      new Error('ES cluster unavailable'),
    );

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(503);

    expect(batch.begin).toHaveBeenCalledTimes(1);
    expect(batch.addAllAttachments).toHaveBeenCalledTimes(1);
    // end must still be called despite addAllAttachments throwing
    expect(batch.end).toHaveBeenCalledTimes(1);
  });
});
