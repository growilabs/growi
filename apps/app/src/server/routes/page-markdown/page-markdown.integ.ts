import type { IUser } from '@growi/core';
import express from 'express';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

import { pageMarkdownRouteFactory } from '.';

// Route-level integration test for the page-markdown interception route.
//
// Approach: real MongoDB + real Page / Revision / User models, the real
// grant-aware finder, and the REAL authorization middlewares composed by the
// factory (accessTokenParser + loginRequired). Nothing in the auth path is
// mocked; instead an upstream middleware optionally injects `req.user` (the
// job normally done by session/PAT resolution) so authenticated scenarios can
// be exercised, and guest scenarios run through the genuine loginRequired
// middleware whose ACL answer is controlled per-test via a spy.
//
// A sentinel fallback handler is mounted AFTER the factory to observe
// next()/passthrough: any request the factory lets through lands on the
// sentinel, mirroring how the production catch-all delegates to the HTML flow.
//
// Bootstrap mirrors respond-with-page-markdown.integ.ts (real Page/Revision seeding).

// Per-worker prefix isolates fixtures when Vitest runs workers in parallel.
const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/mdroute-${WORKER_ID}`;
const SENTINEL = 'HTML_FALLBACK_SENTINEL';

type RevisionDoc = {
  pageId: mongoose.Types.ObjectId;
  body: string;
  format: string;
  author: mongoose.Types.ObjectId;
};

describe('pageMarkdownRouteFactory (route integration)', () => {
  let crowi: Crowi;
  let app: express.Application;
  let Page: PageModel;
  let User: Model<IUser>;
  let Revision: Model<RevisionDoc>;

  let testUser: HydratedDocument<IUser>;
  let otherUser: HydratedDocument<IUser>;

  // The user injected upstream for the current request (undefined => anonymous).
  let currentUser: HydratedDocument<IUser> | undefined;

  let docId: string; // public page at `${BASE}/doc`
  let secretId: string; // GRANT_OWNER page owned by otherUser (forbidden to testUser)

  const bodyDoc = 'DOC-BODY-CONTENT-VERBATIM';
  const bodySecret = 'SECRET-BODY-DO-NOT-LEAK';
  const bodyLiteral = 'LITERAL-MD-PAGE-BODY';

  const seededPaths = [`${BASE}/doc`, `${BASE}/secret`, `${BASE}/literal.md`];

  beforeAll(async () => {
    crowi = await getInstance();

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');
    Revision = mongoose.model<RevisionDoc>('Revision');

    const testUserName = `mdroute-user-${WORKER_ID}`;
    const otherUserName = `mdroute-other-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [testUserName, otherUserName] } });
    testUser = await User.create({
      name: testUserName,
      username: testUserName,
      email: `${testUserName}@example.com`,
    });
    otherUser = await User.create({
      name: otherUserName,
      username: otherUserName,
      email: `${otherUserName}@example.com`,
    });

    // Idempotency: wipe any leftover fixtures from a prior aborted run.
    await Page.deleteMany({ path: { $in: seededPaths } });

    const doc = await Page.create({
      path: `${BASE}/doc`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: 0,
    });
    const secret = await Page.create({
      path: `${BASE}/secret`,
      grant: Page.GRANT_OWNER,
      grantedUsers: [otherUser._id],
      creator: otherUser._id,
      lastUpdateUser: otherUser._id,
      descendantCount: 0,
    });
    // A page whose path literally ends with `.md`. isCreatablePage forbids
    // this via normal flows, so it is seeded directly (backward-compat safety
    // net for imported/legacy data) to exercise literal-wins (Requirement 2.1).
    const literal = await Page.create({
      path: `${BASE}/literal.md`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: 0,
    });

    const revisions = await Revision.insertMany([
      {
        pageId: doc._id,
        body: bodyDoc,
        format: 'markdown',
        author: testUser._id,
      },
      {
        pageId: secret._id,
        body: bodySecret,
        format: 'markdown',
        author: otherUser._id,
      },
      {
        pageId: literal._id,
        body: bodyLiteral,
        format: 'markdown',
        author: testUser._id,
      },
    ]);
    doc.revision = revisions[0]._id;
    secret.revision = revisions[1]._id;
    literal.revision = revisions[2]._id;
    await doc.save();
    await secret.save();
    await literal.save();

    docId = String(doc._id);
    secretId = String(secret._id);

    // Build the app once: express.json ensures req.body is defined (production
    // mounts body parsers upstream of the catch-all); the injector emulates
    // session/PAT user resolution; the sentinel observes fall-through.
    app = express();
    app.use(express.json());
    app.use((req: CrowiRequest, _res, next) => {
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    app.use(pageMarkdownRouteFactory(crowi));
    app.use((_req, res) => {
      res.status(200).type('text/html').send(SENTINEL);
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await Page.deleteMany({ path: { $in: seededPaths } });
    } catch {
      // ignore
    }
    try {
      await User.deleteMany({ _id: { $in: [testUser?._id, otherUser?._id] } });
    } catch {
      // ignore
    }
  }, 30_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('markdown retrieval (Requirement 1.1, 1.2, 1.3)', () => {
    it('serves permalink /{pageId}.md as text/markdown with the verbatim body and footer', async () => {
      currentUser = testUser;

      const res = await request(app).get(`/${docId}.md`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.headers['content-type']).toContain('charset=utf-8');
      expect(res.text).toContain(bodyDoc);
      // navigation footer is present (page-list API hint is always included, 4.6)
      expect(res.text).toContain(`/_api/v3/page-listing/children?id=${docId}`);
    });

    it('serves {path}.md for a base page that exists', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/doc.md`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyDoc);
    });

    it('serves a plain page URL with Accept: text/markdown', async () => {
      currentUser = testUser;

      const res = await request(app)
        .get(`${BASE}/doc`)
        .set('Accept', 'text/markdown');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyDoc);
    });

    it('serves a plain page URL with ?format=md', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/doc`).query({ format: 'md' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyDoc);
    });
  });

  describe('content negotiation guard', () => {
    it('does NOT hijack a plain URL sent with the curl-default Accept: */*', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/doc`).set('Accept', '*/*');

      // */* must not count as an explicit text/markdown request, so the request
      // falls through to the HTML sentinel rather than being served as markdown.
      expect(res.status).toBe(200);
      expect(res.text).toBe(SENTINEL);
    });
  });

  describe('not found (Requirement 1.5, 2.3, 3.5)', () => {
    it('returns 404 text/markdown guidance when neither the path nor its base exists', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/no-such-page-xyz.md`);

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain('404');
    });
  });

  describe('forbidden (Requirement 3.1, 3.2, 3.5)', () => {
    it('returns 403 text/markdown guidance without leaking the protected body', async () => {
      currentUser = testUser; // not the owner of the GRANT_OWNER page

      const res = await request(app).get(`/${secretId}.md`);

      expect(res.status).toBe(403);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain('403');
      expect(res.text).not.toContain(bodySecret);
    });
  });

  describe('literal .md collision (Requirement 2.1, 2.4)', () => {
    it('passes a literal .md page through to the HTML sentinel (backward compat)', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/literal.md`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(SENTINEL);
    });

    it('serves the literal .md page own markdown when Accept is explicit (no stripping)', async () => {
      currentUser = testUser;

      const res = await request(app)
        .get(`${BASE}/literal.md`)
        .set('Accept', 'text/markdown');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyLiteral);
    });
  });

  describe('guest access (Requirement 3.3, 3.4)', () => {
    it('serves a public page anonymously when guest read is allowed', async () => {
      currentUser = undefined; // anonymous
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(true);

      const res = await request(app).get(`/${docId}.md`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyDoc);
    });

    it('follows loginRequired (redirect to /login) for an anonymous request when guest read is disallowed', async () => {
      currentUser = undefined; // anonymous
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await request(app).get(`/${docId}.md`).redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/login');
    });
  });

  describe('GET-only + HTML delivery preserved', () => {
    it('does not intercept non-GET requests (POST falls through to the sentinel)', async () => {
      currentUser = testUser;

      const res = await request(app).post(`/${docId}.md`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(SENTINEL);
    });

    it('does not intercept a plain page GET without Accept/format (normal HTML delivery preserved)', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/doc`);

      expect(res.status).toBe(200);
      expect(res.text).toBe(SENTINEL);
    });
  });
});
