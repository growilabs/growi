import type { NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import type { MockInstance } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

const { ObjectId } = Types;

// Extend Request for the per-test user injection and shared-page flag.
interface TestRequest extends Request {
  user?: { _id: Types.ObjectId } | null;
  isSharedPage?: boolean;
}

/**
 * Integration tests for the share-link authorization on `/comments.get`.
 *
 * The security guarantees under test (see design.md "単一 ID 不変条件"):
 *  - certifySharedPage sets isSharedPage ONLY when shareLinkId resolves to a
 *    ShareLink whose relatedPage === the requested page_id and is not expired.
 *  - comment.api.get bypasses the viewer access check only for that verified
 *    page_id, and in a share context ignores revision_id (which could point to
 *    a different page) — fetching strictly by page_id (CRITICAL-1 / CRITICAL-2).
 *  - write operations never consult isSharedPage (read-only boundary).
 *
 * loginRequired is wired as a stand-in that mirrors the only branches this
 * feature depends on (login-required.ts): a guest passes iff the request is a
 * verified shared page; an authenticated user always passes. The full ACL
 * behavior of the real middleware is covered by its own tests.
 */
describe('/comments.get share-link authorization (integration)', () => {
  let crowi: Crowi;
  let app: express.Application;
  // `isAccessiblePageByViewer` is a JS-defined static (obsolete-page.js) that is
  // not on the TS PageModel interface, and crowi.models.Page's default export is
  // typed `any`, so there is no usable type to spy on here.
  // biome-ignore lint/suspicious/noExplicitAny: no usable type for Page (see above)
  let Page: any;
  let certifySharedPage: RequestHandler;

  // Controllable request user, read by the injector middleware at request time.
  let currentUser: { _id: Types.ObjectId } | null = null;
  let accessSpy: MockInstance;

  // Seeded ids (page A is the share-link target; page B is a foreign page).
  const pageAId = new ObjectId();
  const pageBId = new ObjectId();
  const revAId = new ObjectId();
  const revBId = new ObjectId();
  let commentAId: string;
  let commentBId: string;
  let inlineCommentAId: string;
  let shareLinkAId: Types.ObjectId;
  let expiredShareLinkId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();
    Page = crowi.models.Page;

    // api.remove reads the comment with `include: { page: true }` (a required
    // relation), so the referenced pages must actually exist: Prisma throws on a
    // required relation whose target is missing (the pre-migration mongoose test
    // relied on populate silently yielding null instead).
    await prisma.pages.create({
      data: { id: pageAId.toString(), path: '/comment-integ-a', v: 0 },
    });
    await prisma.pages.create({
      data: { id: pageBId.toString(), path: '/comment-integ-b', v: 0 },
    });

    // api.update re-links the comment with `revision: { connect: { id } }`, and
    // Prisma rejects a `connect` to a missing record, so revision A must exist
    // as a real row (the GET tests only ever use these ids as stored scalars).
    await prisma.revisions.create({
      data: {
        id: revAId.toString(),
        v: 0,
        authorId: new ObjectId().toString(),
        body: 'revision A body',
        format: 'markdown',
        pageId: pageAId.toString(),
      },
    });

    // Seed one comment on page A and one on page B (with distinct revisions).
    // Comments live in Prisma (the mongoose Comment model was migrated), so
    // seed through the same `prisma.comments.add` the route handler uses.
    const commentA = await prisma.comments.add(
      pageAId.toString(),
      new ObjectId().toString(),
      revAId.toString(),
      'comment on page A',
      -1,
    );
    const commentB = await prisma.comments.add(
      pageBId.toString(),
      new ObjectId().toString(),
      revBId.toString(),
      'comment on page B',
      -1,
    );
    commentAId = commentA.id;
    commentBId = commentB.id;

    // An inline comment on page A, seeded alongside the normal comment above.
    // `prisma.comments.add` never writes `isInline`, so this is created
    // directly through `prisma.comments.create` (task 1.3: the read paths
    // exercised below must exclude this row unconditionally).
    const inlineCommentA = await prisma.comments.create({
      data: {
        pageId: pageAId.toString(),
        creatorId: new ObjectId().toString(),
        revisionId: revAId.toString(),
        comment: 'inline comment on page A',
        commentPosition: -1,
        isInline: true,
        quote: 'quoted text',
      },
    });
    inlineCommentAId = inlineCommentA.id;

    // Share links related to page A: one valid, one expired.
    const shareLinkA = await prisma.sharelinks.create({
      data: { relatedPageId: pageAId.toString() },
    });
    const expiredShareLink = await prisma.sharelinks.create({
      data: {
        relatedPageId: pageAId.toString(),
        expiredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    shareLinkAId = new ObjectId(shareLinkA.id);
    expiredShareLinkId = new ObjectId(expiredShareLink.id);

    const apiV1FormValidator = (
      await import('~/server/middlewares/apiv1-form-validator')
    ).default;
    const { setup: setupComment } = await import('~/server/routes/comment');
    const comment = setupComment(crowi, {});
    const { setup: setupCertifySharedPage } = await import(
      '~/server/middlewares/certify-shared-page'
    );
    certifySharedPage = setupCertifySharedPage(crowi);

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Inject the controllable user (stands in for accessTokenParser / session).
    app.use((req: TestRequest, _res: Response, next: NextFunction) => {
      req.user = currentUser ?? undefined;
      next();
    });

    // Guest-allowing loginRequired stand-in (the branches this feature relies on).
    const loginRequired = (
      req: TestRequest,
      res: Response,
      next: NextFunction,
    ) => {
      if (req.isSharedPage || req.user != null) {
        return next();
      }
      return res.status(403).json({ ok: false });
    };

    app.get(
      '/comments.get',
      comment.api.validators.get(),
      apiV1FormValidator,
      certifySharedPage,
      loginRequired,
      comment.api.get,
    );

    // Write routes mirror routes/index.js: NO certifySharedPage. The injected
    // `req.isSharedPage = true` proves the handlers ignore the share context.
    const forceShared = (
      req: TestRequest,
      _res: Response,
      next: NextFunction,
    ) => {
      req.isSharedPage = true;
      next();
    };
    // routes/index.js puts `addActivity` in front of every write route, so the
    // handlers' success paths read `res.locals.activity._id`. Mirror that here,
    // otherwise a success path would fail for a reason unrelated to the route.
    const stubActivity = (
      _req: TestRequest,
      res: Response,
      next: NextFunction,
    ) => {
      res.locals.activity = { _id: new ObjectId() };
      next();
    };

    app.post('/comments.add', forceShared, stubActivity, comment.api.add);
    app.post('/comments.update', forceShared, stubActivity, comment.api.update);
    app.post('/comments.remove', forceShared, stubActivity, comment.api.remove);
  });

  beforeEach(() => {
    currentUser = null;
    accessSpy = vi
      .spyOn(Page, 'isAccessiblePageByViewer')
      .mockResolvedValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // comments also has a required relation to revisions (onDelete: NoAction),
    // so it must be deleted first and alone. revisions/sharelinks then have no
    // relation to each other -- only to pages -- so they can run concurrently.
    // pages must be deleted last, and separately, or Prisma throws P2014 for
    // deleting a page while a dependent still refers to it (see the same
    // reasoning in delete-completely-operation.ts).
    await prisma.comments.deleteMany({
      where: { id: { in: [commentAId, commentBId, inlineCommentAId] } },
    });
    await Promise.all([
      prisma.revisions.deleteMany({ where: { id: revAId.toString() } }),
      prisma.sharelinks.deleteMany({
        where: {
          id: {
            in: [shareLinkAId.toString(), expiredShareLinkId.toString()],
          },
        },
      }),
    ]);
    await prisma.pages.deleteMany({
      where: { id: { in: [pageAId.toString(), pageBId.toString()] } },
    });
  });

  describe('certifySharedPage verification', () => {
    const runCertify = async (query: Request['query']): Promise<boolean> => {
      // A minimal literal stub is required here (not mock<TestRequest>()): the
      // middleware reads absent query keys as `undefined` (e.g. `req.query.pageId
      // || ...`), but a deep mock returns stub functions for absent keys, which
      // would break those reads. The middleware only touches query/body/next.
      const req = { query, body: {} } as unknown as TestRequest;
      await certifySharedPage(req, {} as Response, () => undefined);
      return req.isSharedPage === true;
    };

    it('marks the request as shared when shareLinkId matches the page', async () => {
      const isShared = await runCertify({
        page_id: pageAId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });
      expect(isShared).toBe(true);
    });

    it('does NOT mark shared when the share link belongs to another page (CRITICAL-1)', async () => {
      const isShared = await runCertify({
        page_id: pageBId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });
      expect(isShared).toBe(false);
    });

    it('does NOT mark shared when the share link is expired', async () => {
      const isShared = await runCertify({
        page_id: pageAId.toString(),
        shareLinkId: expiredShareLinkId.toString(),
      });
      expect(isShared).toBe(false);
    });

    it('does nothing when shareLinkId is absent', async () => {
      const isShared = await runCertify({ page_id: pageAId.toString() });
      expect(isShared).toBe(false);
    });

    it('does NOT mark shared when pageId and page_id disagree (verify/fetch split guard)', async () => {
      const isShared = await runCertify({
        pageId: pageAId.toString(),
        page_id: pageBId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });
      expect(isShared).toBe(false);
    });

    it('still marks shared when pageId and page_id are present but equal', async () => {
      const isShared = await runCertify({
        pageId: pageAId.toString(),
        page_id: pageAId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });
      expect(isShared).toBe(true);
    });
  });

  describe('GET /comments.get — share-link context', () => {
    it('returns the comments of the shared page without an access check', async () => {
      const res = await request(app).get('/comments.get').query({
        page_id: pageAId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0]._id).toBe(commentAId.toString());
      // bypass: the viewer access check is not consulted for the verified page
      expect(accessSpy).not.toHaveBeenCalled();
    });

    it('ignores revision_id in a share context and fetches strictly by page_id (CRITICAL-2)', async () => {
      // revision of page B is passed, but only page A comments must be returned
      const res = await request(app).get('/comments.get').query({
        page_id: pageAId.toString(),
        shareLinkId: shareLinkAId.toString(),
        revision_id: revBId.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0]._id).toBe(commentAId.toString());
      expect(res.body.comments[0]._id).not.toBe(commentBId.toString());
    });

    it('does not grant share-based access for a page the link does not target (CRITICAL-1, authenticated)', async () => {
      // shareLinkId of page A, but requesting page B; authenticated viewer who
      // cannot access B -> handler denies (no share bypass for B).
      currentUser = { _id: new ObjectId() };
      const res = await request(app).get('/comments.get').query({
        page_id: pageBId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.comments).toBeUndefined();
      expect(accessSpy).toHaveBeenCalledWith(pageBId.toString(), currentUser);
    });

    it('rejects a guest with a share link that targets another page (CRITICAL-1, guest)', async () => {
      const res = await request(app).get('/comments.get').query({
        page_id: pageBId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });

      // certifySharedPage does not mark shared -> guest blocked at loginRequired
      expect(res.status).toBe(403);
      expect(res.body.comments).toBeUndefined();
    });

    it('rejects a guest with an expired share link', async () => {
      const res = await request(app).get('/comments.get').query({
        page_id: pageAId.toString(),
        shareLinkId: expiredShareLinkId.toString(),
      });

      expect(res.status).toBe(403);
      expect(res.body.comments).toBeUndefined();
    });

    it('blocks a verify/fetch split: share link for A + page_id=B does not leak B (authenticated)', async () => {
      // Attacker holds a valid share link to accessible page A and tries to read
      // private page B by sending both ids: pageId=A (what certify would verify)
      // and page_id=B (what the handler fetches).
      currentUser = { _id: new ObjectId() };
      const res = await request(app).get('/comments.get').query({
        pageId: pageAId.toString(),
        page_id: pageBId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.comments).toBeUndefined();
      // certify refused (ambiguous ids) -> no share bypass -> access to B checked
      expect(accessSpy).toHaveBeenCalledWith(pageBId.toString(), currentUser);
    });

    it('blocks a verify/fetch split for a guest (no leak of B)', async () => {
      const res = await request(app).get('/comments.get').query({
        pageId: pageAId.toString(),
        page_id: pageBId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });

      expect(res.status).toBe(403);
      expect(res.body.comments).toBeUndefined();
    });
  });

  describe('GET /comments.get — non-shared (authenticated) access is unchanged', () => {
    it('returns comments by page_id when the viewer is accessible', async () => {
      currentUser = { _id: new ObjectId() };
      accessSpy.mockResolvedValue(true);

      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: pageAId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0]._id).toBe(commentAId.toString());
    });

    it('still honors revision_id outside a share context', async () => {
      currentUser = { _id: new ObjectId() };
      accessSpy.mockResolvedValue(true);

      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: pageAId.toString(), revision_id: revBId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      // non-shared revision_id path is preserved -> resolves page B's comment
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0]._id).toBe(commentBId.toString());
    });

    it('denies an authenticated viewer who cannot access the page', async () => {
      currentUser = { _id: new ObjectId() };
      accessSpy.mockResolvedValue(false);

      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: pageAId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.comments).toBeUndefined();
    });

    it('rejects a guest with no share-link context', async () => {
      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: pageAId.toString() });

      expect(res.status).toBe(403);
      expect(res.body.comments).toBeUndefined();
    });
  });

  /**
   * Requirements 6.1 / 6.3: `/comments.get` must never return an
   * `isInline: true` row, in either the shared-link context or the normal
   * (non-shared) context. Page A carries both a normal comment
   * (`commentAId`) and an inline comment (`inlineCommentAId`) seeded above;
   * every assertion below checks the response contains only the normal one.
   */
  describe('GET /comments.get — inline comments are excluded (6.1, 6.3)', () => {
    it('excludes isInline rows in the share-link context', async () => {
      const res = await request(app).get('/comments.get').query({
        page_id: pageAId.toString(),
        shareLinkId: shareLinkAId.toString(),
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const ids = res.body.comments.map(
        (comment: { _id: string }) => comment._id,
      );
      expect(ids).toContain(commentAId.toString());
      expect(ids).not.toContain(inlineCommentAId.toString());
    });

    it('excludes isInline rows in the normal (non-shared) context', async () => {
      currentUser = { _id: new ObjectId() };
      accessSpy.mockResolvedValue(true);

      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: pageAId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      const ids = res.body.comments.map(
        (comment: { _id: string }) => comment._id,
      );
      expect(ids).toContain(commentAId.toString());
      expect(ids).not.toContain(inlineCommentAId.toString());
    });
  });

  describe('GET /comments.get — input validation (NoSQL injection surface)', () => {
    const expectValidationRejected = (
      // biome-ignore lint/suspicious/noExplicitAny: supertest response
      res: any,
    ) => {
      // apiV1FormValidator responds with an array of error objects (HTTP 200)
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].ok).toBe(false);
      expect(res.body[0].code).toBe('validation_failed');
    };

    it('rejects a non-MongoId page_id', async () => {
      currentUser = { _id: new ObjectId() };
      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: 'not-a-mongo-id' });

      expectValidationRejected(res);
      expect(accessSpy).not.toHaveBeenCalled();
    });

    it('rejects an object-injection page_id (`page_id[$gt]=`)', async () => {
      currentUser = { _id: new ObjectId() };
      const res = await request(app)
        .get('/comments.get')
        .query({ 'page_id[$gt]': '' });

      expectValidationRejected(res);
      expect(accessSpy).not.toHaveBeenCalled();
    });

    it('rejects an array-valued page_id (Mongoose $in / cross-page IDOR)', async () => {
      // Both ids are valid MongoIds individually. Without a scalar guard,
      // `.isMongoId()` passes the array and Mongoose casts `find({ page: [A,B] })`
      // into an implicit `$in`, leaking page B's comments to a viewer who only
      // has access to page A. The scalar `.isString()` guard must reject it
      // before the handler runs.
      currentUser = { _id: new ObjectId() };
      accessSpy.mockResolvedValue(true);
      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: [pageAId.toString(), pageBId.toString()] });

      expectValidationRejected(res);
      // never reaches the access check or the handler -> no cross-page $in leak
      expect(accessSpy).not.toHaveBeenCalled();
    });

    it('rejects a non-MongoId shareLinkId', async () => {
      currentUser = { _id: new ObjectId() };
      const res = await request(app)
        .get('/comments.get')
        .query({ page_id: pageAId.toString(), shareLinkId: 'bad' });

      expectValidationRejected(res);
    });

    it('skips an empty-string revision_id (checkFalsy) instead of rejecting it', async () => {
      // `.optional({ checkFalsy: true })` must treat `revision_id=` as absent so
      // external API callers stay backward compatible; the request resolves by
      // page_id in the share context rather than failing MongoId validation.
      const res = await request(app).get('/comments.get').query({
        page_id: pageAId.toString(),
        shareLinkId: shareLinkAId.toString(),
        revision_id: '',
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0]._id).toBe(commentAId.toString());
    });
  });

  describe('write operations ignore the share context (read-only boundary)', () => {
    it('comments.add denies even when isSharedPage is set', async () => {
      const res = await request(app)
        .post('/comments.add')
        .send({
          commentForm: {
            page_id: pageAId.toString(),
            revision_id: revAId.toString(),
            comment: 'should not be saved',
            comment_position: -1,
            replyTo: '',
          },
          slackNotificationForm: { isSlackEnabled: false },
        });

      expect(res.body.ok).toBe(false);
      // the access check is consulted (not bypassed by the share context)
      expect(accessSpy).toHaveBeenCalled();
    });

    it('comments.update denies even when isSharedPage is set', async () => {
      const res = await request(app)
        .post('/comments.update')
        .send({
          commentForm: {
            comment: 'edited',
            comment_id: commentAId.toString(),
            revision_id: revAId.toString(),
          },
        });

      expect(res.body.ok).toBe(false);
      expect(accessSpy).toHaveBeenCalled();
    });

    it('comments.remove denies even when isSharedPage is set', async () => {
      const res = await request(app)
        .post('/comments.remove')
        .send({ comment_id: commentAId.toString() });

      expect(res.body.ok).toBe(false);
      expect(accessSpy).toHaveBeenCalled();
    });
  });

  /**
   * The authorized-editor path of `/comments.update`.
   *
   * Every pre-existing `/comments.update` test above exercises a rejection, so
   * the handler could (and did) fail to produce any response at all on the happy
   * path without a single test noticing. When that happens the request never
   * completes: the comment is written to the DB, but the client's `await` never
   * settles, so the comment editor stays open and the edit looks like it did
   * nothing. These tests pin the response itself.
   */
  describe('POST /comments.update — authorized editor', () => {
    const editorId = new ObjectId();
    let editableCommentId: string;

    const sendUpdate = (comment: string) =>
      request(app)
        .post('/comments.update')
        .send({
          commentForm: {
            comment,
            comment_id: editableCommentId,
            revision_id: revAId.toString(),
          },
        });

    beforeEach(async () => {
      const seeded = await prisma.comments.add(
        pageAId.toString(),
        editorId.toString(),
        revAId.toString(),
        'original body',
        -1,
      );
      editableCommentId = seeded.id;

      // the creator of the comment, on a page they can access
      currentUser = { _id: editorId };
      accessSpy.mockResolvedValue(true);
    });

    afterEach(async () => {
      await prisma.comments.deleteMany({ where: { id: editableCommentId } });
    });

    it('responds with the updated comment', async () => {
      const res = await sendUpdate('edited body');

      expect(res.body.ok).toBe(true);
      // mongoose-compatible field names, as `/comments.get` and `/comments.add` return
      expect(res.body.comment).toMatchObject({
        _id: editableCommentId,
        comment: 'edited body',
        page: pageAId.toString(),
        creator: editorId.toString(),
        revision: revAId.toString(),
      });
    });

    it('persists the new comment body', async () => {
      await sendUpdate('edited body');

      const stored = await prisma.comments.findUnique({
        where: { id: editableCommentId },
      });
      expect(stored?.comment).toBe('edited body');
    });
  });
});
