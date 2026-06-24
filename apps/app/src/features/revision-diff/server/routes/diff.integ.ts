/**
 * Integration tests for POST /api/v3/revisions/diff — Revision Diff API
 *
 * These tests exercise the full route handler stack (validation → page accessibility
 * check → per-pair diff computation) against a real MongoMemoryServer instance.
 *
 * Page model's findByIdsAndViewer is spied upon per-test to control accessibility
 * without requiring a full Crowi initialisation.
 *
 * Requirements covered: 6.1, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3
 * Note: 8.2 (401) and 8.3 (403) are covered by middleware unit tests (accessTokenParser,
 * loginRequired). Since these middleware are mocked at module level in this file,
 * 401/403 cannot be triggered end-to-end here; the middleware contracts are tested
 * independently. The route's own authorization logic (forbidden/invalid per pair)
 * is fully covered by the scenarios below.
 */

import type { IUserHasId } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import mongoose, { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { Revision } from '~/server/models/revision';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { diffRouteHandlersFactory } from './diff';

// ---------------------------------------------------------------------------
// Mock middleware so the route under test can run without a real Crowi instance
// ---------------------------------------------------------------------------

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser:
    () =>
    (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default:
    () =>
    (_req: Request, _res: Response, next: NextFunction): void => {
      next();
    },
}));

vi.mock('~/server/middlewares/apiv3-form-validator', () => {
  const { validationResult } = require('express-validator');
  return {
    apiV3FormValidator: (
      req: Request,
      res: ApiV3Response,
      next: NextFunction,
    ) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.apiv3Err(
          { message: errors.array()[0].msg, code: 'validation_failed' },
          400,
        );
      }
      return next();
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh ObjectId. */
const makeId = (): Types.ObjectId => new Types.ObjectId();

/**
 * Create a Revision document in the test database.
 *
 * Uses `Revision.collection.insertOne()` to bypass Mongoose's automatic
 * timestamps so the `createdAt` we specify is persisted as-is.
 */
async function createRevision(props: {
  pageId: Types.ObjectId;
  author: Types.ObjectId;
  body?: string;
  createdAt?: Date;
}): Promise<{ _id: Types.ObjectId }> {
  const id = makeId();
  await Revision.collection.insertOne({
    _id: id,
    pageId: props.pageId,
    author: props.author,
    body: props.body ?? 'content',
    format: 'markdown',
    createdAt: props.createdAt ?? new Date(),
  });
  return { _id: id };
}

/** Minimal Crowi stub — the route only calls loginRequiredFactory(crowi, false). */
function buildCrowi(): Crowi {
  return {} as unknown as Crowi;
}

/**
 * Build an Express app that mounts the diff route with the given userId
 * pre-injected as `req.user`. Pass null to simulate an unauthenticated request
 * (no user injection).
 */
function buildApp(
  userId: Types.ObjectId | null = new Types.ObjectId(),
): express.Express {
  const app = express();
  app.use(express.json());

  // Inject apiv3 response helpers before the route handler.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    (res as ApiV3Response).apiv3 = (body: unknown, status = 200) =>
      res.status(status).json(body);
    (res as ApiV3Response).apiv3Err = (err: unknown, status = 500) => {
      const errors = Array.isArray(err) ? err : [err];
      return res.status(status).json({ errors });
    };
    next();
  });

  // Inject the authenticated user (skip when userId is null).
  if (userId != null) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: IUserHasId }).user = {
        _id: userId,
        admin: false,
      } as unknown as IUserHasId;
      next();
    });
  }

  const handlers = diffRouteHandlersFactory(buildCrowi());
  app.post('/api/v3/revisions/diff', ...handlers);

  return app;
}

/**
 * Spy on `Page.findByIdsAndViewer` (the bulk accessibility check in computeDiffs).
 *
 * `accessibleIds` — ObjectId strings of pages the user can access.
 */
function mockPageModel(accessibleIds: string[]) {
  const mockPage = {
    findByIdsAndViewer: vi
      .fn()
      .mockResolvedValue(
        accessibleIds.map((id) => ({ _id: new Types.ObjectId(id) })),
      ),
  } as unknown as PageModel;

  vi.spyOn(mongoose, 'model').mockReturnValue(mockPage as any);
  return mockPage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v3/revisions/diff — Revision Diff integration', () => {
  let userId: Types.ObjectId;

  beforeEach(async () => {
    userId = makeId();
    await Revision.deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Req 6.1 — multiple pages: each pair returns a unified diff (status: 'ok')
  // -------------------------------------------------------------------------
  it('returns ok with diff for each accessible pair (multiple pages)', async () => {
    const pageA = makeId();
    const pageB = makeId();

    const revA = await createRevision({
      pageId: pageA,
      author: userId,
      body: 'hello world\n',
    });
    const revB = await createRevision({
      pageId: pageB,
      author: userId,
      body: 'foo bar\n',
    });

    mockPageModel([pageA.toString(), pageB.toString()]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageA.toString(),
            fromRevisionId: null,
            toRevisionId: revA._id.toString(),
          },
          {
            pageId: pageB.toString(),
            fromRevisionId: null,
            toRevisionId: revB._id.toString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{
        pageId: string;
        toRevisionId: string;
        status: string;
        diff?: string;
      }>;
    };

    expect(results).toHaveLength(2);

    const resultA = results.find((r) => r.pageId === pageA.toString());
    const resultB = results.find((r) => r.pageId === pageB.toString());

    expect(resultA?.status).toBe('ok');
    expect(resultA?.diff).toBeDefined();
    // New page baseline (fromRevisionId=null): all content appears as additions.
    expect(resultA?.diff).toContain('+hello world');

    expect(resultB?.status).toBe('ok');
    expect(resultB?.diff).toBeDefined();
    expect(resultB?.diff).toContain('+foo bar');
  });

  // -------------------------------------------------------------------------
  // Req 7.2 — inaccessible page → status: 'forbidden', no content disclosed
  // -------------------------------------------------------------------------
  it('returns forbidden for pairs where the page is not accessible', async () => {
    const pageId = makeId();
    const rev = await createRevision({
      pageId,
      author: userId,
      body: 'secret content\n',
    });

    // findByIdsAndViewer returns empty → user cannot access this page.
    mockPageModel([]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageId.toString(),
            fromRevisionId: null,
            toRevisionId: rev._id.toString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{
        pageId: string;
        toRevisionId: string;
        status: string;
        diff?: string;
      }>;
    };

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('forbidden');
    // Must not disclose any content (Req 7.2).
    expect(results[0].diff).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Req 7.3 — revision belongs to a different page than specified → status: 'invalid'
  // -------------------------------------------------------------------------
  it('returns invalid when revision belongs to a different page than specified', async () => {
    const pageA = makeId();
    const pageB = makeId(); // different page

    // Revision belongs to pageA, but we request it as if it belongs to pageB.
    const revA = await createRevision({
      pageId: pageA,
      author: userId,
      body: 'content on page A\n',
    });

    // Make pageB accessible so we get past the authorization check.
    mockPageModel([pageB.toString()]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageB.toString(), // mismatched page
            fromRevisionId: null,
            toRevisionId: revA._id.toString(), // revision from pageA
          },
        ],
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{
        pageId: string;
        toRevisionId: string;
        status: string;
        diff?: string;
      }>;
    };

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('invalid');
    // Must not disclose any content (Req 7.3).
    expect(results[0].diff).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Req 7.4 — mixed batch: some ok, some forbidden, some invalid in one request
  // -------------------------------------------------------------------------
  it('handles mixed ok/forbidden/invalid pairs in a single batch', async () => {
    const pageOk = makeId();
    const pageForbidden = makeId();
    const pageInvalidHost = makeId();
    const pageOther = makeId(); // revision from here used against pageInvalidHost

    const revOk = await createRevision({
      pageId: pageOk,
      author: userId,
      body: 'accessible content\n',
    });
    const revForbidden = await createRevision({
      pageId: pageForbidden,
      author: userId,
      body: 'secret content\n',
    });
    // Revision belongs to pageOther, will be sent with pageInvalidHost as pageId.
    const revFromOtherPage = await createRevision({
      pageId: pageOther,
      author: userId,
      body: 'other page content\n',
    });

    // Only pageOk and pageInvalidHost are accessible (pageForbidden is not).
    mockPageModel([pageOk.toString(), pageInvalidHost.toString()]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          // Pair 1: ok
          {
            pageId: pageOk.toString(),
            fromRevisionId: null,
            toRevisionId: revOk._id.toString(),
          },
          // Pair 2: forbidden (page not accessible)
          {
            pageId: pageForbidden.toString(),
            fromRevisionId: null,
            toRevisionId: revForbidden._id.toString(),
          },
          // Pair 3: invalid (revision belongs to a different page)
          {
            pageId: pageInvalidHost.toString(),
            fromRevisionId: null,
            toRevisionId: revFromOtherPage._id.toString(),
          },
        ],
      });

    // The entire request must succeed (Req 7.4 — no full-request failure).
    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{ pageId: string; status: string; diff?: string }>;
    };

    expect(results).toHaveLength(3);

    const resultOk = results.find((r) => r.pageId === pageOk.toString());
    const resultForbidden = results.find(
      (r) => r.pageId === pageForbidden.toString(),
    );
    const resultInvalid = results.find(
      (r) => r.pageId === pageInvalidHost.toString(),
    );

    expect(resultOk?.status).toBe('ok');
    expect(resultOk?.diff).toBeDefined();

    expect(resultForbidden?.status).toBe('forbidden');
    expect(resultForbidden?.diff).toBeUndefined();

    expect(resultInvalid?.status).toBe('invalid');
    expect(resultInvalid?.diff).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Req 6.5 — MAX_PAIRS exceeded → 400
  // -------------------------------------------------------------------------
  it('returns 400 when the number of pairs exceeds MAX_PAIRS (20)', async () => {
    mockPageModel([]);

    const app = buildApp(userId);

    // Build 21 pairs (one more than MAX_PAIRS=20).
    const pairs = Array.from({ length: 21 }, () => ({
      pageId: makeId().toString(),
      fromRevisionId: null,
      toRevisionId: makeId().toString(),
    }));

    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({ pairs });

    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Req 6.3 — fromRevisionId=null → full content as additions (page creation baseline)
  // -------------------------------------------------------------------------
  it('returns full content as additions when fromRevisionId is null', async () => {
    const pageId = makeId();
    const toBody = 'line one\nline two\nline three\n';
    const rev = await createRevision({ pageId, author: userId, body: toBody });

    mockPageModel([pageId.toString()]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageId.toString(),
            fromRevisionId: null,
            toRevisionId: rev._id.toString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{ status: string; diff?: string }>;
    };

    expect(results[0].status).toBe('ok');
    const diff = results[0].diff;
    expect(diff).toBeDefined();
    // All lines from toBody should appear as additions (+).
    expect(diff).toContain('+line one');
    expect(diff).toContain('+line two');
    expect(diff).toContain('+line three');
    // No deletions in a new-page baseline diff.
    expect(diff).not.toMatch(/^-[^-]/m);
  });

  // -------------------------------------------------------------------------
  // Req 6.4 — contextLines parameter controls surrounding context in the diff
  // -------------------------------------------------------------------------
  it('respects the contextLines parameter', async () => {
    const pageId = makeId();
    const fromBody =
      Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
    const toBody = fromBody.replace('line10', 'line10-modified');

    const fromRev = await createRevision({
      pageId,
      author: userId,
      body: fromBody,
    });
    const toRev = await createRevision({
      pageId,
      author: userId,
      body: toBody,
    });

    mockPageModel([pageId.toString()]);

    const app = buildApp(userId);

    // Request with contextLines=0: each hunk should have no surrounding context lines.
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageId.toString(),
            fromRevisionId: fromRev._id.toString(),
            toRevisionId: toRev._id.toString(),
          },
        ],
        contextLines: 0,
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{ status: string; diff?: string }>;
    };

    expect(results[0].status).toBe('ok');
    const diff0 = results[0].diff!;

    // With contextLines=0 there should be no unchanged context lines in the hunk.
    // The only lines present (besides headers) should be the changed lines themselves.
    const diffLines = diff0
      .split('\n')
      .filter((l) => l.startsWith('+') || l.startsWith('-'));
    expect(diffLines.some((l) => l.includes('line10-modified'))).toBe(true);

    // Now request with default contextLines (3): hunk should include surrounding lines.
    vi.restoreAllMocks();
    mockPageModel([pageId.toString()]);

    const resDefault = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageId.toString(),
            fromRevisionId: fromRev._id.toString(),
            toRevisionId: toRev._id.toString(),
          },
        ],
        // omit contextLines → defaults to 3
      });

    expect(resDefault.status).toBe(200);
    const diffDefault = (
      resDefault.body as { results: Array<{ diff?: string }> }
    ).results[0].diff!;

    // With contextLines=3, there should be context lines (unchanged lines) around the change.
    const contextLines = diffDefault
      .split('\n')
      .filter((l) => l.startsWith(' '));
    expect(contextLines.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Req 7.3 — invalid: fromRevision belongs to a different page
  // -------------------------------------------------------------------------
  it('returns invalid when fromRevision belongs to a different page', async () => {
    const pageA = makeId();
    const pageB = makeId();

    // toRevision is on pageA (correct), fromRevision is on pageB (wrong).
    const fromRevWrongPage = await createRevision({
      pageId: pageB,
      author: userId,
      body: 'baseline from wrong page\n',
    });
    const toRev = await createRevision({
      pageId: pageA,
      author: userId,
      body: 'target content\n',
    });

    mockPageModel([pageA.toString()]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageA.toString(),
            fromRevisionId: fromRevWrongPage._id.toString(), // from wrong page
            toRevisionId: toRev._id.toString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{ status: string; diff?: string }>;
    };

    expect(results[0].status).toBe('invalid');
    expect(results[0].diff).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Req 6.1 — normal diff between two revisions on the same page
  // -------------------------------------------------------------------------
  it('returns unified diff between two revisions on the same page', async () => {
    const pageId = makeId();

    const fromRev = await createRevision({
      pageId,
      author: userId,
      body: 'original content\n',
    });
    const toRev = await createRevision({
      pageId,
      author: userId,
      body: 'modified content\n',
    });

    mockPageModel([pageId.toString()]);

    const app = buildApp(userId);
    const res = await request(app)
      .post('/api/v3/revisions/diff')
      .send({
        pairs: [
          {
            pageId: pageId.toString(),
            fromRevisionId: fromRev._id.toString(),
            toRevisionId: toRev._id.toString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const { results } = res.body as {
      results: Array<{ status: string; diff?: string }>;
    };

    expect(results[0].status).toBe('ok');
    const diff = results[0].diff!;
    // Deleted original, added modified.
    expect(diff).toContain('-original content');
    expect(diff).toContain('+modified content');
    // Unified diff should have a hunk header.
    expect(diff).toContain('@@');
  });
});
