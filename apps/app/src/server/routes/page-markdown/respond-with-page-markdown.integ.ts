import type { IUser } from '@growi/core';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

import {
  type MarkdownResolution,
  respondWithPageMarkdown,
} from './respond-with-page-markdown';

// Helper-level integration test for respondWithPageMarkdown.
//
// Approach: real MongoDB + real Page / Revision / User models and the real
// grant-aware finder (`findPageAndMetaDataByViewer`) + pageListingService. No
// supertest / Express — the route factory (task 3.1) is out of scope here.
// Authorization is exercised for real (never mocked) so the resolution reflects
// the genuine viewer contract.
//
// Bootstrap mirrors get-page-content-tool.integ.ts (real Page/Revision seeding).

// Per-worker prefix isolates fixtures when Vitest runs workers in parallel.
const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const BASE = `/mdtest-${WORKER_ID}`;
const ORIGIN = 'https://md.example.test';

type RevisionDoc = {
  pageId: mongoose.Types.ObjectId;
  body: string;
  format: string;
  author: mongoose.Types.ObjectId;
};

// Narrow a resolution to its markdown body, failing loudly on passthrough.
function markdownOf(res: MarkdownResolution): string {
  if (res.type === 'passthrough') {
    throw new Error(
      'expected a markdown-bearing resolution but got passthrough',
    );
  }
  return res.markdown;
}

describe('respondWithPageMarkdown (integration)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUser>;
  let Revision: Model<RevisionDoc>;

  let testUser: HydratedDocument<IUser>;
  let otherUser: HydratedDocument<IUser>;

  // Seeded pages (ids captured for permalink resolution + link assertions).
  let hubId: string; // parent==null (root-like), has children aaa/bbb
  let aaaId: string; // child of hub, sibling of bbb
  let bbbId: string; // child of hub, sibling of aaa
  let secretId: string; // GRANT_OWNER owned by otherUser
  let emptyId: string; // empty container page (no revision)

  const bodyAaa = 'AAA-BODY-CONTENT-VERBATIM';
  const bodyBbb = 'BBB-BODY';
  const bodyHub = 'HUB-BODY-CONTENT';
  const bodySecret = 'SECRET-BODY-DO-NOT-LEAK';
  const bodyLiteral = 'LITERAL-MD-PAGE-BODY';
  const bodyDoc = 'BASE-DOC-BODY';

  const HUB_DESCENDANT_COUNT = 5;

  beforeAll(async () => {
    crowi = await getInstance();

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');
    Revision = mongoose.model<RevisionDoc>('Revision');

    const testUserName = `mdtest-user-${WORKER_ID}`;
    const otherUserName = `mdtest-other-${WORKER_ID}`;
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
    const seededPaths = [
      `${BASE}/hub`,
      `${BASE}/hub/aaa`,
      `${BASE}/hub/bbb`,
      `${BASE}/secret`,
      `${BASE}/literal.md`,
      `${BASE}/doc`,
      `${BASE}/empty`,
    ];
    await Page.deleteMany({ path: { $in: seededPaths } });

    // Root-like hub: parent omitted (null) so the footer must omit parent AND
    // siblings (Requirement 4.8). descendantCount is distinct from the direct
    // child count (Requirement 4.3).
    const hub = await Page.create({
      path: `${BASE}/hub`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: HUB_DESCENDANT_COUNT,
    });
    const aaa = await Page.create({
      path: `${BASE}/hub/aaa`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      parent: hub._id,
      descendantCount: 0,
    });
    const bbb = await Page.create({
      path: `${BASE}/hub/bbb`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      parent: hub._id,
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
    const literal = await Page.create({
      path: `${BASE}/literal.md`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: 0,
    });
    const doc = await Page.create({
      path: `${BASE}/doc`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      descendantCount: 0,
    });
    // Empty container page: no revision, no lastUpdateUser (mirrors the empty
    // container in page-listing.integ.ts). The footer must still render.
    const empty = await Page.create({
      path: `${BASE}/empty`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      isEmpty: true,
      descendantCount: 1,
    });

    const revisions = await Revision.insertMany([
      {
        pageId: hub._id,
        body: bodyHub,
        format: 'markdown',
        author: testUser._id,
      },
      {
        pageId: aaa._id,
        body: bodyAaa,
        format: 'markdown',
        author: testUser._id,
      },
      {
        pageId: bbb._id,
        body: bodyBbb,
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
        pageId: doc._id,
        body: bodyDoc,
        format: 'markdown',
        author: testUser._id,
      },
    ]);

    hub.revision = revisions[0]._id;
    aaa.revision = revisions[1]._id;
    bbb.revision = revisions[2]._id;
    secret.revision = revisions[3]._id;
    literal.revision = revisions[4]._id;
    doc.revision = revisions[5]._id;
    await hub.save();
    await aaa.save();
    await bbb.save();
    await secret.save();
    await literal.save();
    await doc.save();

    hubId = String(hub._id);
    aaaId = String(aaa._id);
    bbbId = String(bbb._id);
    secretId = String(secret._id);
    emptyId = String(empty._id);
  }, 60_000);

  afterAll(async () => {
    try {
      await Page.deleteMany({
        path: {
          $in: [
            `${BASE}/hub`,
            `${BASE}/hub/aaa`,
            `${BASE}/hub/bbb`,
            `${BASE}/secret`,
            `${BASE}/literal.md`,
            `${BASE}/doc`,
            `${BASE}/empty`,
          ],
        },
      });
    } catch {
      // ignore
    }
    try {
      await User.deleteMany({ _id: { $in: [testUser?._id, otherUser?._id] } });
    } catch {
      // ignore
    }
  }, 30_000);

  const call = (
    reqPath: string,
    user: HydratedDocument<IUser> | undefined,
    opts: { accept?: string; formatQuery?: string } = {},
  ): Promise<MarkdownResolution> =>
    respondWithPageMarkdown(crowi, {
      reqPath,
      accept: opts.accept,
      formatQuery: opts.formatQuery,
      user,
      origin: ORIGIN,
    });

  describe('ok resolution: body + footer', () => {
    it('resolves a public page by permalink and returns the revision body verbatim plus canonical URL, permalink, and updater username', async () => {
      const res = await call(`/${aaaId}.md`, testUser);

      expect(res.type).toBe('ok');
      const md = markdownOf(res);
      // body is passed through verbatim (populate regression guard, 1.4/4.5)
      expect(md).toContain(bodyAaa);
      // footer provenance (4.1, 4.5)
      expect(md).toContain(`${ORIGIN}${BASE}/hub/aaa`); // canonical URL
      expect(md).toContain(`${ORIGIN}/${aaaId}`); // permalink
      expect(md).toContain(testUser.username); // serialized updater
      // page-list API hint is always present (4.6)
      expect(md).toContain(`/_api/v3/page-listing/children?id=${aaaId}`);
    });

    it('resolves a public page anonymously (guest) when the page is public', async () => {
      const res = await call(`/${aaaId}.md`, undefined);

      expect(res.type).toBe('ok');
      expect(markdownOf(res)).toContain(bodyAaa);
    });
  });

  describe('footer: children counts + descendantCount, root omits parent/siblings', () => {
    it('lists direct children as permalink .md links with the exact direct-child total and a separate descendant total, and omits parent/siblings for a root-like page', async () => {
      const res = await call(`/${hubId}.md`, testUser);

      expect(res.type).toBe('ok');
      const md = markdownOf(res);
      expect(md).toContain(bodyHub);
      // child links in permalink .md form (4.2-4.4)
      expect(md).toContain(`(/${aaaId}.md)`);
      expect(md).toContain(`(/${bbbId}.md)`);
      // exact direct-child total (2 seeded), distinct from descendantCount (4.3)
      expect(md).toContain('Children: 2 total');
      expect(md).toContain(`Total descendants: ${HUB_DESCENDANT_COUNT}`);
      // root-like (parent == null): no parent or sibling lines (4.8)
      expect(md).not.toContain('Parent:');
      expect(md).not.toContain('Siblings:');
    });
  });

  describe('footer: parent link + siblings excluding self', () => {
    it('includes the parent link and sibling links, excluding the page itself', async () => {
      const res = await call(`/${aaaId}.md`, testUser);

      expect(res.type).toBe('ok');
      const md = markdownOf(res);
      // parent link to hub
      expect(md).toContain(`- Parent: [hub](/${hubId}.md)`);
      // sibling bbb present, self (aaa) excluded from the sibling list.
      expect(md).toContain('Siblings: 1 total');
      expect(md).toContain(`(/${bbbId}.md)`);
      // The self permalink `.md` link never appears (permalinkUrl/hint use the
      // bare id without a `.md` suffix, so this uniquely proves self-exclusion).
      expect(md).not.toContain(`/${aaaId}.md`);
    });
  });

  describe('forbidden resolution', () => {
    it('returns forbidden with guidance and no page content when the viewer lacks permission', async () => {
      const res = await call(`/${secretId}.md`, testUser);

      expect(res.type).toBe('forbidden');
      const md = markdownOf(res);
      expect(md).toContain('403');
      // never leak the protected body
      expect(md).not.toContain(bodySecret);
    });
  });

  describe('notFound resolution', () => {
    it('returns notFound with guidance when neither the path nor its base exists', async () => {
      const res = await call(`${BASE}/no-such-page-xyz.md`, testUser);

      expect(res.type).toBe('notFound');
      expect(markdownOf(res)).toContain('404');
    });
  });

  describe('literal-wins (.md suffix) resolution', () => {
    it('passes through when a real page literally exists at the .md path (backward compat)', async () => {
      const res = await call(`${BASE}/literal.md`, testUser);

      expect(res.type).toBe('passthrough');
    });

    it('returns the literal .md page own markdown when the request is explicit (Accept), without stripping', async () => {
      const res = await call(`${BASE}/literal.md`, testUser, {
        accept: 'text/markdown',
      });

      expect(res.type).toBe('ok');
      expect(markdownOf(res)).toContain(bodyLiteral);
    });

    it('strips the trailing .md and returns the base page markdown when no literal page exists', async () => {
      const res = await call(`${BASE}/doc.md`, testUser);

      expect(res.type).toBe('ok');
      expect(markdownOf(res)).toContain(bodyDoc);
    });
  });

  describe('empty (container) page', () => {
    it('returns ok with a no-body notice plus footer, without crashing', async () => {
      const res = await call(`/${emptyId}.md`, testUser);

      expect(res.type).toBe('ok');
      const md = markdownOf(res);
      expect(md).toContain('This page has no content yet.');
      // footer still rendered for empty pages (5.1-5.3)
      expect(md).toContain(`${ORIGIN}${BASE}/empty`);
    });
  });
});
