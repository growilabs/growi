import type { IUser } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import type { PageDocument, PageModel } from '~/server/models/page';

import { pageMarkdownRouteFactory } from '.';
import { MARKDOWN_FOOTER_MAX_LINKS } from './constants';

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
  let bigId: string; // public root-like page with more than the footer link cap of children

  // Real Personal Access Tokens for testUser: one with the page-read scope the
  // route requires, one deliberately scoped elsewhere (used to prove the scope
  // gate actually rejects). These flow through the genuine accessTokenParser
  // mounted by the factory — nothing in the token path is mocked.
  let patToken: string;
  let patWrongScopeToken: string;

  const bodyDoc = 'DOC-BODY-CONTENT-VERBATIM';
  const bodySecret = 'SECRET-BODY-DO-NOT-LEAK';
  const bodyLiteral = 'LITERAL-MD-PAGE-BODY';
  const bodyBig = 'BIG-PARENT-BODY';
  const bodySpace = 'SPACE-PATH-BODY';
  const bodyJp = 'JP-PATH-BODY';

  // Pages whose paths arrive percent-encoded on the wire: DB paths are stored
  // decoded ("/space page"), but clients request "/space%20page.md" (browsers
  // and HTTP libraries always percent-encode), and Express's req.path keeps
  // that encoding. These fixtures prove the route resolves the decoded page.
  const spacePath = `${BASE}/space page`;
  const jpPath = `${BASE}/日本語ページ`;

  // Over-limit fixture: seed MORE direct children than the footer cap so the
  // response must truncate the link list, state the exact total and remainder
  // (Requirement 4.7), and load at most the cap into memory (Requirement 4.3).
  const OVER_LIMIT_CHILD_COUNT = MARKDOWN_FOOTER_MAX_LINKS + 5;
  // Distinct from the direct-child count so the footer's separate descendant
  // total can be proven to not be conflated with it (Requirement 4.3).
  const BIG_DESCENDANT_COUNT = MARKDOWN_FOOTER_MAX_LINKS + 10;
  const bigParentPath = `${BASE}/big`;
  const bigChildPaths = Array.from(
    { length: OVER_LIMIT_CHILD_COUNT },
    (_, i) => `${bigParentPath}/c${String(i).padStart(2, '0')}`,
  );

  const seededPaths = [
    `${BASE}/doc`,
    `${BASE}/secret`,
    `${BASE}/literal.md`,
    bigParentPath,
    ...bigChildPaths,
    spacePath,
    jpPath,
  ];

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
    // Root-like public hub with more direct children than the footer link cap.
    // Its descendantCount is deliberately larger still, so the footer's
    // direct-child total and descendant total are visibly different numbers.
    const big = await Page.create({
      path: bigParentPath,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: BIG_DESCENDANT_COUNT,
    });
    await Page.insertMany(
      bigChildPaths.map((path) => ({
        path,
        parent: big._id,
        grant: Page.GRANT_PUBLIC,
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        descendantCount: 0,
      })),
    );
    const spacePage = await Page.create({
      path: spacePath,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: 0,
    });
    const jpPage = await Page.create({
      path: jpPath,
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
      {
        pageId: big._id,
        body: bodyBig,
        format: 'markdown',
        author: testUser._id,
      },
      {
        pageId: spacePage._id,
        body: bodySpace,
        format: 'markdown',
        author: testUser._id,
      },
      {
        pageId: jpPage._id,
        body: bodyJp,
        format: 'markdown',
        author: testUser._id,
      },
    ]);
    doc.revision = revisions[0]._id;
    secret.revision = revisions[1]._id;
    literal.revision = revisions[2]._id;
    big.revision = revisions[3]._id;
    spacePage.revision = revisions[4]._id;
    jpPage.revision = revisions[5]._id;
    await doc.save();
    await secret.save();
    await literal.save();
    await big.save();
    await spacePage.save();
    await jpPage.save();

    docId = String(doc._id);
    secretId = String(secret._id);
    bigId = String(big._id);

    // Seed real access tokens. generateToken + the route's accessTokenParser
    // both normalize scopes identically, so the required-scope token satisfies
    // the route's [READ.FEATURES.PAGE] check while the other one does not.
    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    patToken = (
      await AccessToken.generateToken(testUser._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;
    patWrongScopeToken = (
      await AccessToken.generateToken(testUser._id, oneDayLater, [
        SCOPE.READ.USER_SETTINGS.INFO,
      ])
    ).token;

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
      await AccessToken.deleteAllTokensByUserId(testUser?._id);
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

  describe('percent-encoded request paths (Requirement 1.2, 1.3, 7.2)', () => {
    it('serves {path}.md for a path containing a space, requested in the percent-encoded form clients actually send', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${encodeURI(spacePath)}.md`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodySpace);
    });

    it('serves {path}.md for a non-ASCII (Japanese) path requested percent-encoded', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${encodeURI(jpPath)}.md`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyJp);
    });

    it('serves a percent-encoded plain URL with Accept: text/markdown', async () => {
      currentUser = testUser;

      const res = await request(app)
        .get(encodeURI(jpPath))
        .set('Accept', 'text/markdown');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyJp);
    });

    it('yields the platform-level 400 for a malformed percent-escape (Express rejects it before any route handler, same as the HTML catch-all)', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/broken%zz.md`);

      expect(res.status).toBe(400);
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

  describe('content-negotiation response headers', () => {
    // The same URL serves either HTML or markdown depending on Accept, and
    // markdown bodies are viewer-specific. Without Vary + an explicit
    // Cache-Control, a shared cache (reverse proxy / CDN) may store the
    // markdown variant and serve it to a browser expecting HTML.
    it('marks a 200 markdown response as Accept-varying and non-cacheable', async () => {
      currentUser = testUser;

      const res = await request(app).get(`/${docId}.md`);

      expect(res.status).toBe(200);
      expect(res.headers.vary).toContain('Accept');
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('marks a 404 markdown response as Accept-varying and non-cacheable too', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/no-such-page-xyz.md`);

      expect(res.status).toBe(404);
      expect(res.headers.vary).toContain('Accept');
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('does not add the markdown headers to a passthrough (HTML) response', async () => {
      currentUser = testUser;

      const res = await request(app).get(`${BASE}/literal.md`);

      expect(res.text).toBe(SENTINEL);
      expect(res.headers['cache-control']).toBeUndefined();
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

    it('falls back to the base page when Accept: text/markdown is sent to a sugar-form {path}.md URL (Requirement 2.5)', async () => {
      currentUser = testUser;

      // Agents handed a sugar-form ".md" URL routinely add an explicit Accept
      // header; that combination must not turn a working URL into a 404.
      const res = await request(app)
        .get(`${BASE}/doc.md`)
        .set('Accept', 'text/markdown');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyDoc);
    });

    it('resolves a permalink .md URL sent with Accept: text/markdown (Requirement 2.5)', async () => {
      currentUser = testUser;

      const res = await request(app)
        .get(`/${docId}.md`)
        .set('Accept', 'text/markdown');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain(bodyDoc);
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

  describe('over-limit footer (Requirement 4.3, 4.7)', () => {
    it('caps child links at MARKDOWN_FOOTER_MAX_LINKS while stating the exact total, the omitted remainder, and a separate descendant total', async () => {
      currentUser = testUser;

      const res = await request(app).get(`/${bigId}.md`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');

      // Overflow is stated explicitly, never silently truncated: the exact
      // direct-child total and the omitted remainder both appear (4.7).
      expect(res.text).toContain(
        `Children: ${MARKDOWN_FOOTER_MAX_LINKS} of ${OVER_LIMIT_CHILD_COUNT} total`,
      );
      const remainder = OVER_LIMIT_CHILD_COUNT - MARKDOWN_FOOTER_MAX_LINKS;
      expect(res.text).toContain(`${remainder} more not shown`);

      // descendantCount is reported separately from the direct-child count and
      // the two seeded values differ, proving they are not conflated (4.3).
      expect(res.text).toContain(`Total descendants: ${BIG_DESCENDANT_COUNT}`);

      // Memory-bounded rendering: at most MARKDOWN_FOOTER_MAX_LINKS child links
      // are emitted even though more children exist. For this root-like page
      // there are no parent/sibling sections, so the indented list items are
      // exactly the child links — counting them is unambiguous.
      const childLinkLines = res.text
        .split('\n')
        .filter((line) => /^ {2}- \[/.test(line));
      expect(childLinkLines).toHaveLength(MARKDOWN_FOOTER_MAX_LINKS);
    });
  });

  describe('PAT (Personal Access Token) authentication (Requirement 3.1)', () => {
    it('authenticates a markdown request via a real Bearer token through the genuine accessTokenParser, even when guest read is disallowed', async () => {
      currentUser = undefined; // no session; the token is the ONLY credential
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await request(app)
        .get(`/${docId}.md`)
        .set('Authorization', `Bearer ${patToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      // populate regression across the full route round-trip: the finder does
      // not populate, so both the verbatim body and the updater username must be
      // reconstituted by the helper and present in the HTTP response (1.4, 4.5).
      expect(res.text).toContain(bodyDoc);
      expect(res.text).toContain(testUser.username);
    });

    it('does not authenticate a token lacking the required page-read scope, deferring to loginRequired (redirect to /login)', async () => {
      currentUser = undefined;
      vi.spyOn(crowi.aclService, 'isGuestAllowedToRead').mockReturnValue(false);

      const res = await request(app)
        .get(`/${docId}.md`)
        .set('Authorization', `Bearer ${patWrongScopeToken}`)
        .redirects(0);

      // The token is valid but out of scope, so no user is resolved and the
      // request follows the same guest-disallowed path as a tokenless one.
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
