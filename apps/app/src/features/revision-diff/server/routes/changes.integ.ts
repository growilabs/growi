/**
 * Integration tests for GET /api/v3/revisions/changes — Changes Index
 *
 * These tests exercise the full route handler stack (validation → aggregation pipeline
 * → run-building → flag application) against a real MongoMemoryServer instance.
 *
 * Page model's findByIdsAndViewer and Page.find are spied upon per-test to control
 * accessibility without requiring a full Crowi initialisation.
 *
 * Requirements covered: 1.1, 1.3, 1.5, 2.1, 2.2, 3.3, 3.4, 4.1, 4.2, 5.1, 5.2, 5.3, 5.4
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

import { changesRouteHandlersFactory } from './changes';

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
 * Create a Revision document in the test database with a precise `createdAt`.
 *
 * Uses `Revision.collection.insertOne()` to bypass Mongoose's automatic
 * timestamps so the `createdAt` we specify is persisted as-is.  Mongoose's
 * `timestamps: { createdAt: true }` would otherwise overwrite any value
 * passed to `create()` / `save()`.
 */
async function createRevision(props: {
  pageId: Types.ObjectId;
  author: Types.ObjectId;
  createdAt: Date;
  body?: string;
}): Promise<{ _id: Types.ObjectId }> {
  const id = makeId();
  await Revision.collection.insertOne({
    _id: id,
    pageId: props.pageId,
    author: props.author,
    body: props.body ?? 'content',
    format: 'markdown',
    createdAt: props.createdAt,
  });
  return { _id: id };
}

/** Minimal Crowi stub — the route only calls loginRequiredFactory(crowi, false). */
function buildCrowi(): Crowi {
  return {} as unknown as Crowi;
}

/**
 * Build an Express app that mounts the changes route with the given userId
 * pre-injected as `req.user`.  The `apiv3` / `apiv3Err` helpers are wired
 * before the route so the route handler can call them.
 */
function buildApp(userId: Types.ObjectId): express.Express {
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

  // Inject the authenticated user.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: IUserHasId }).user = {
      _id: userId,
      admin: false,
    } as unknown as IUserHasId;
    next();
  });

  const handlers = changesRouteHandlersFactory(buildCrowi());
  app.get('/api/v3/revisions/changes', ...handlers);

  return app;
}

/**
 * Spy on `Page.findByIdsAndViewer` and `Page.find` (the two bulk queries in listChanges).
 *
 * `accessibleIds` — ObjectId strings of pages the user can access.
 * `pageInfos`     — minimal page info docs (status + path) returned by Page.find.
 */
function mockPageQueries(
  accessibleIds: string[],
  pageInfos: Array<{ _id: Types.ObjectId; status?: string; path?: string }>,
) {
  const mockPage = {
    findByIdsAndViewer: vi
      .fn()
      .mockResolvedValue(
        accessibleIds.map((id) => ({ _id: new Types.ObjectId(id) })),
      ),
    find: vi.fn().mockReturnValue({
      lean: () => Promise.resolve(pageInfos),
    }),
  } as unknown as PageModel;

  vi.spyOn(mongoose, 'model').mockReturnValue(mockPage as any);
  return mockPage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v3/revisions/changes — Changes Index integration', () => {
  let userId: Types.ObjectId;

  beforeEach(async () => {
    userId = makeId();
    await Revision.deleteMany({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Req 1.3 — empty result when user has no revisions in range
  // -------------------------------------------------------------------------
  it('returns empty changes array when user has no revisions', async () => {
    const pageId = makeId();
    mockPageQueries([], []);

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ changes: [], next: null });
  });

  // -------------------------------------------------------------------------
  // Req 1.1 — period-scoped query returns user's cross-page changes
  // -------------------------------------------------------------------------
  it('returns cross-page changes within since/toDate range', async () => {
    const pageA = makeId();
    const pageB = makeId();
    const t1 = new Date('2024-01-01T10:00:00Z');
    const t2 = new Date('2024-01-01T11:00:00Z');
    const t3 = new Date('2024-01-01T12:00:00Z'); // outside range

    const rev1 = await createRevision({
      pageId: pageA,
      author: userId,
      createdAt: t1,
    });
    const rev2 = await createRevision({
      pageId: pageB,
      author: userId,
      createdAt: t2,
    });
    // This revision is outside the toDate range and should not appear.
    await createRevision({ pageId: pageA, author: userId, createdAt: t3 });

    const pageAIdStr = pageA.toString();
    const pageBIdStr = pageB.toString();

    mockPageQueries(
      [pageAIdStr, pageBIdStr],
      [
        { _id: pageA, status: 'published', path: '/page-a' },
        { _id: pageB, status: 'published', path: '/page-b' },
      ],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes').query({
      since: '2024-01-01T00:00:00Z',
      toDate: '2024-01-01T11:30:00Z',
    });

    expect(res.status).toBe(200);
    const { changes, next } = res.body as {
      changes: Array<{
        pageId: string;
        toRevisionId: string;
        fromRevisionId: string | null;
        accessible: boolean;
        path: string | null;
      }>;
      next: string | null;
    };

    // Should return two runs (one per page) and no cursor (all results fit in one page).
    expect(changes).toHaveLength(2);
    expect(next).toBeNull();

    const pageIds = changes.map((c) => c.pageId);
    expect(pageIds).toContain(pageAIdStr);
    expect(pageIds).toContain(pageBIdStr);

    // Each run's toRevisionId should match the single revision on that page.
    const entryA = changes.find((c) => c.pageId === pageAIdStr);
    const entryB = changes.find((c) => c.pageId === pageBIdStr);
    expect(entryA?.toRevisionId).toBe(rev1._id.toString());
    expect(entryB?.toRevisionId).toBe(rev2._id.toString());
  });

  // -------------------------------------------------------------------------
  // Req 1.5 — invalid date range returns 400
  // -------------------------------------------------------------------------
  it('returns 400 when fromDate is after toDate', async () => {
    mockPageQueries([], []);
    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes').query({
      fromDate: '2024-01-10T00:00:00Z',
      toDate: '2024-01-01T00:00:00Z',
    });

    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // Req 2.1, 2.2 — userId from query is ignored; only authenticated user is targeted
  // -------------------------------------------------------------------------
  it('ignores userId query param and uses the authenticated user', async () => {
    const otherUserId = makeId();
    const pageId = makeId();

    // Create one revision for the authenticated user and one for another user.
    const myRev = await createRevision({
      pageId,
      author: userId,
      createdAt: new Date('2024-01-01T10:00:00Z'),
    });
    await createRevision({
      pageId,
      author: otherUserId,
      createdAt: new Date('2024-01-01T11:00:00Z'),
    });

    const pageIdStr = pageId.toString();
    mockPageQueries(
      [pageIdStr],
      [{ _id: pageId, status: 'published', path: '/test' }],
    );

    const app = buildApp(userId);
    // Pass a userId query param pointing to the other user — it must be ignored.
    const res = await request(app)
      .get('/api/v3/revisions/changes')
      .query({ userId: otherUserId.toString() });

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{ toRevisionId: string }>;
    };

    // Only our own revision should appear, not the other user's.
    expect(changes).toHaveLength(1);
    expect(changes[0].toRevisionId).toBe(myRev._id.toString());
  });

  // -------------------------------------------------------------------------
  // Req 4.1 — consecutive own edits on the same page are merged into one run
  // -------------------------------------------------------------------------
  it('merges consecutive own edits on the same page into a single run', async () => {
    const pageId = makeId();
    const t1 = new Date('2024-02-01T10:00:00Z');
    const t2 = new Date('2024-02-01T11:00:00Z');
    const t3 = new Date('2024-02-01T12:00:00Z');

    // Three consecutive edits by the same user — should produce exactly one run.
    await createRevision({ pageId, author: userId, createdAt: t1, body: 'v1' });
    await createRevision({ pageId, author: userId, createdAt: t2, body: 'v2' });
    const rev3 = await createRevision({
      pageId,
      author: userId,
      createdAt: t3,
      body: 'v3',
    });

    const pageIdStr = pageId.toString();
    mockPageQueries(
      [pageIdStr],
      [{ _id: pageId, status: 'published', path: '/page' }],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{
        pageId: string;
        fromRevisionId: string | null;
        toRevisionId: string;
      }>;
    };

    // All three edits should collapse into one run.
    expect(changes).toHaveLength(1);
    expect(changes[0].pageId).toBe(pageIdStr);
    // Baseline is null because our user created the page (no prior revision).
    expect(changes[0].fromRevisionId).toBeNull();
    // The run ends at the last edit.
    expect(changes[0].toRevisionId).toBe(rev3._id.toString());
  });

  // -------------------------------------------------------------------------
  // Req 4.2 — another author's edit between our edits splits the run
  // -------------------------------------------------------------------------
  it('splits into two runs when another author interrupts consecutive edits', async () => {
    const pageId = makeId();
    const otherUser = makeId();
    const t1 = new Date('2024-03-01T08:00:00Z');
    const t2 = new Date('2024-03-01T09:00:00Z'); // other author
    const t3 = new Date('2024-03-01T10:00:00Z');

    const rev1 = await createRevision({
      pageId,
      author: userId,
      createdAt: t1,
    });
    const revOther = await createRevision({
      pageId,
      author: otherUser,
      createdAt: t2,
    });
    const rev3 = await createRevision({
      pageId,
      author: userId,
      createdAt: t3,
    });

    const pageIdStr = pageId.toString();
    mockPageQueries(
      [pageIdStr],
      [{ _id: pageId, status: 'published', path: '/page' }],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{
        pageId: string;
        fromRevisionId: string | null;
        toRevisionId: string;
      }>;
    };

    // The interrupting author splits the sequence into two runs.
    expect(changes).toHaveLength(2);

    // First run: from=null (page creation), to=rev1.
    const run1 = changes[0];
    expect(run1.fromRevisionId).toBeNull();
    expect(run1.toRevisionId).toBe(rev1._id.toString());

    // Second run: from=revOther (baseline is the interrupting edit), to=rev3.
    const run2 = changes[1];
    expect(run2.fromRevisionId).toBe(revOther._id.toString());
    expect(run2.toRevisionId).toBe(rev3._id.toString());
  });

  // -------------------------------------------------------------------------
  // Req 3.3, 3.4 — cursor pagination: no duplicates or missed entries across pages
  // -------------------------------------------------------------------------
  it('paginates across multiple pages without duplicates or missed entries', async () => {
    const pageA = makeId();
    const pageB = makeId();
    const pageC = makeId();

    // Three separate single-edit runs (one per page).
    const rev1 = await createRevision({
      pageId: pageA,
      author: userId,
      createdAt: new Date('2024-04-01T01:00:00Z'),
    });
    const rev2 = await createRevision({
      pageId: pageB,
      author: userId,
      createdAt: new Date('2024-04-01T02:00:00Z'),
    });
    const rev3 = await createRevision({
      pageId: pageC,
      author: userId,
      createdAt: new Date('2024-04-01T03:00:00Z'),
    });

    const pageAStr = pageA.toString();
    const pageBStr = pageB.toString();
    const pageCStr = pageC.toString();

    // Respond differently depending on which pageIds are requested.
    // We return all three pages as accessible and present.
    const allPageInfos = [
      { _id: pageA, status: 'published', path: '/a' },
      { _id: pageB, status: 'published', path: '/b' },
      { _id: pageC, status: 'published', path: '/c' },
    ];

    // First page: limit=1 → should return rev1 and a cursor.
    const mockPage1 = {
      findByIdsAndViewer: vi.fn().mockResolvedValue([{ _id: pageA }]),
      find: vi.fn().mockReturnValue({
        lean: () => Promise.resolve([allPageInfos[0]]),
      }),
    } as unknown as PageModel;
    vi.spyOn(mongoose, 'model').mockReturnValue(mockPage1 as any);

    const app = buildApp(userId);
    const page1 = await request(app)
      .get('/api/v3/revisions/changes')
      .query({ limit: '1' });

    expect(page1.status).toBe(200);
    const { changes: changes1, next: cursor1 } = page1.body as {
      changes: Array<{ pageId: string; toRevisionId: string }>;
      next: string | null;
    };
    expect(changes1).toHaveLength(1);
    expect(changes1[0].pageId).toBe(pageAStr);
    expect(changes1[0].toRevisionId).toBe(rev1._id.toString());
    expect(cursor1).not.toBeNull();

    vi.restoreAllMocks();

    // Second page: cursor from page 1, limit=1 → should return rev2.
    const mockPage2 = {
      findByIdsAndViewer: vi.fn().mockResolvedValue([{ _id: pageB }]),
      find: vi.fn().mockReturnValue({
        lean: () => Promise.resolve([allPageInfos[1]]),
      }),
    } as unknown as PageModel;
    vi.spyOn(mongoose, 'model').mockReturnValue(mockPage2 as any);

    const page2 = await request(app)
      .get('/api/v3/revisions/changes')
      .query({ limit: '1', cursor: cursor1! });

    expect(page2.status).toBe(200);
    const { changes: changes2, next: cursor2 } = page2.body as {
      changes: Array<{ pageId: string; toRevisionId: string }>;
      next: string | null;
    };
    expect(changes2).toHaveLength(1);
    expect(changes2[0].pageId).toBe(pageBStr);
    expect(changes2[0].toRevisionId).toBe(rev2._id.toString());
    expect(cursor2).not.toBeNull();

    vi.restoreAllMocks();

    // Third page: cursor from page 2, limit=1 → should return rev3, next=null.
    const mockPage3 = {
      findByIdsAndViewer: vi.fn().mockResolvedValue([{ _id: pageC }]),
      find: vi.fn().mockReturnValue({
        lean: () => Promise.resolve([allPageInfos[2]]),
      }),
    } as unknown as PageModel;
    vi.spyOn(mongoose, 'model').mockReturnValue(mockPage3 as any);

    const page3 = await request(app)
      .get('/api/v3/revisions/changes')
      .query({ limit: '1', cursor: cursor2! });

    expect(page3.status).toBe(200);
    const { changes: changes3, next: cursor3 } = page3.body as {
      changes: Array<{ pageId: string; toRevisionId: string }>;
      next: string | null;
    };
    expect(changes3).toHaveLength(1);
    expect(changes3[0].pageId).toBe(pageCStr);
    expect(changes3[0].toRevisionId).toBe(rev3._id.toString());
    expect(cursor3).toBeNull(); // last page

    // Verify all three revisions are covered with no duplicates.
    const allToRevIds = [...changes1, ...changes2, ...changes3].map(
      (c) => c.toRevisionId,
    );
    expect(new Set(allToRevIds).size).toBe(3);
    expect(allToRevIds).toContain(rev1._id.toString());
    expect(allToRevIds).toContain(rev2._id.toString());
    expect(allToRevIds).toContain(rev3._id.toString());
  });

  // -------------------------------------------------------------------------
  // Req 5.1 — accessible page → path is included in the entry
  // -------------------------------------------------------------------------
  it('includes path when page is accessible', async () => {
    const pageId = makeId();
    await createRevision({
      pageId,
      author: userId,
      createdAt: new Date('2024-05-01T10:00:00Z'),
    });

    mockPageQueries(
      [pageId.toString()],
      [{ _id: pageId, status: 'published', path: '/visible-page' }],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{
        accessible: boolean;
        deleted: boolean;
        path: string | null;
      }>;
    };
    expect(changes).toHaveLength(1);
    expect(changes[0].accessible).toBe(true);
    expect(changes[0].deleted).toBe(false);
    expect(changes[0].path).toBe('/visible-page');
  });

  // -------------------------------------------------------------------------
  // Req 5.2 — inaccessible page → path is null, accessible=false, entry still present
  // -------------------------------------------------------------------------
  it('omits path but includes entry when page is not accessible', async () => {
    const pageId = makeId();
    await createRevision({
      pageId,
      author: userId,
      createdAt: new Date('2024-05-01T11:00:00Z'),
    });

    // findByIdsAndViewer returns empty (user cannot access this page).
    mockPageQueries(
      [],
      [{ _id: pageId, status: 'published', path: '/secret-page' }],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{
        pageId: string;
        accessible: boolean;
        deleted: boolean;
        path: string | null;
      }>;
    };
    // Entry is present (Req 5.4 — not silently excluded).
    expect(changes).toHaveLength(1);
    expect(changes[0].accessible).toBe(false);
    expect(changes[0].deleted).toBe(false);
    // Path must not be disclosed (Req 5.2).
    expect(changes[0].path).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Req 5.3 — deleted (trashed) page → deleted=true, path=null, entry still present
  // -------------------------------------------------------------------------
  it('marks deleted page with deleted=true and omits path', async () => {
    const pageId = makeId();
    await createRevision({
      pageId,
      author: userId,
      createdAt: new Date('2024-05-01T12:00:00Z'),
    });

    // Page is accessible by findByIdsAndViewer (it was accessible when in trash,
    // depending on implementation) but its status is 'deleted'.
    // In the access-flag logic: if status='deleted' then accessible=false and deleted=true.
    mockPageQueries(
      [],
      [{ _id: pageId, status: 'deleted', path: '/trash/old-page' }],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{
        pageId: string;
        accessible: boolean;
        deleted: boolean;
        path: string | null;
      }>;
    };
    // Entry is present (Req 5.4 — not silently excluded).
    expect(changes).toHaveLength(1);
    expect(changes[0].deleted).toBe(true);
    // Path must not be disclosed for deleted pages.
    expect(changes[0].path).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Req 5.4 — absent page (not in DB) → entry is excluded (safety-first)
  // -------------------------------------------------------------------------
  it('excludes entries for pages not found in the database', async () => {
    const pageId = makeId();
    await createRevision({
      pageId,
      author: userId,
      createdAt: new Date('2024-05-01T13:00:00Z'),
    });

    // Page.find returns empty — page has been completely deleted from DB.
    mockPageQueries([], []);

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as { changes: unknown[] };
    // Safety-first: absent pages are excluded from results.
    expect(changes).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Req 4.1, 4.2 — page boundary: runs on different pages are never merged
  // -------------------------------------------------------------------------
  it('never merges runs across page boundaries', async () => {
    const pageA = makeId();
    const pageB = makeId();

    // Both pages edited by the same user in interleaved timestamps.
    const revA1 = await createRevision({
      pageId: pageA,
      author: userId,
      createdAt: new Date('2024-06-01T10:00:00Z'),
    });
    const revB1 = await createRevision({
      pageId: pageB,
      author: userId,
      createdAt: new Date('2024-06-01T10:30:00Z'),
    });
    const revA2 = await createRevision({
      pageId: pageA,
      author: userId,
      createdAt: new Date('2024-06-01T11:00:00Z'),
    });
    const revB2 = await createRevision({
      pageId: pageB,
      author: userId,
      createdAt: new Date('2024-06-01T11:30:00Z'),
    });

    const pageAStr = pageA.toString();
    const pageBStr = pageB.toString();

    mockPageQueries(
      [pageAStr, pageBStr],
      [
        { _id: pageA, status: 'published', path: '/a' },
        { _id: pageB, status: 'published', path: '/b' },
      ],
    );

    const app = buildApp(userId);
    const res = await request(app).get('/api/v3/revisions/changes');

    expect(res.status).toBe(200);
    const { changes } = res.body as {
      changes: Array<{
        pageId: string;
        fromRevisionId: string | null;
        toRevisionId: string;
      }>;
    };

    // Each page should have exactly one run.
    expect(changes).toHaveLength(2);
    const runA = changes.find((c) => c.pageId === pageAStr);
    const runB = changes.find((c) => c.pageId === pageBStr);
    expect(runA).toBeDefined();
    expect(runB).toBeDefined();

    // Runs span the full edit sequence for each page.
    expect(runA!.fromRevisionId).toBeNull();
    expect(runA!.toRevisionId).toBe(revA2._id.toString());
    expect(runB!.fromRevisionId).toBeNull();
    expect(runB!.toRevisionId).toBe(revB2._id.toString());
  });
});
