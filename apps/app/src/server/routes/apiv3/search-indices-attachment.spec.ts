/**
 * Tests for the `includeAttachments` extension on PUT /_api/v3/search/indices.
 *
 * Covers task 8.6 boundary:
 *  1. includeAttachments=false → existing fire-and-forget page rebuild (no batch calls)
 *  2. includeAttachments=true + feature enabled → rebuild started in the background, 200 at once
 *  3. includeAttachments=true + feature disabled → 503
 *  4. includeAttachments=true + batch not registered → 503
 *  5. includeAttachments=true while a rebuild is running → 409
 */

import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

// vi.mock calls below are hoisted by Vite before any imports execute.
// search.js creates a fresh express.Router() inside the factory, so each
// searchRouterFactory(crowi) call produces an independent router per test.
import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';

import { setup as searchRouterFactory } from './search';

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
  startRebuild: ReturnType<typeof vi.fn>;
};

function buildMockBatch(): MockBatch {
  return {
    startRebuild: vi.fn().mockReturnValue(true),
  };
}

interface CrowiStubOptions {
  isConfigured?: boolean;
  isReachable?: boolean;
  attachmentReindexBatch?: MockBatch | null;
}

// attachmentReindexBatch is attached to crowi at runtime by initAttachmentFullTextSearch
// and is not part of the Crowi type.
function buildCrowiStub(
  opts: CrowiStubOptions = {},
): Crowi & { attachmentReindexBatch: MockBatch | null } {
  const {
    isConfigured = true,
    isReachable = true,
    attachmentReindexBatch = null,
  } = opts;
  const crowi = mock<Crowi>({
    searchService: {
      isConfigured,
      isReachable,
      rebuildIndex: vi.fn().mockResolvedValue(undefined),
      normalizeIndices: vi.fn().mockResolvedValue(undefined),
    },
    events: { activity: { emit: vi.fn() } },
  });
  return Object.assign(crowi, { attachmentReindexBatch });
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
    expect(batch.startRebuild).not.toHaveBeenCalled();
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
    expect(batch.startRebuild).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2: includeAttachments=true + feature enabled → started, not awaited
  // -------------------------------------------------------------------------
  it('2. includeAttachments=true + feature enabled → starts the rebuild and answers before it completes', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    // The page rebuild never finishes within this request
    vi.mocked(crowi.searchService.rebuildIndex).mockReturnValue(
      new Promise<void>(() => {}),
    );
    batch.startRebuild.mockImplementation((rebuildPageIndex: () => unknown) => {
      void rebuildPageIndex();
      return true;
    });
    const app = buildTestApp(crowi);

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Operation is successfully requested.');
    expect(batch.startRebuild).toHaveBeenCalledTimes(1);
    // The page rebuild runs as part of it, reporting progress like a page-only rebuild
    expect(crowi.searchService.rebuildIndex).toHaveBeenCalledWith(true);
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
    expect(batch.startRebuild).not.toHaveBeenCalled();
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
  // Test 5: a rebuild is already running → 409
  // -------------------------------------------------------------------------
  it('5. includeAttachments=true while a rebuild is running → 409 rebuild_in_progress', async () => {
    setupFeatureFlag(true);
    const batch = buildMockBatch();
    batch.startRebuild.mockReturnValue(false);
    const crowi = buildCrowiStub({ attachmentReindexBatch: batch });
    const app = buildTestApp(crowi);

    const res = await supertest(app)
      .put('/search/indices')
      .send({ operation: 'rebuild', includeAttachments: true });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('rebuild_in_progress');
  });
});
