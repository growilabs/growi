import type { IUserHasId } from '@growi/core';
import { RequestContext } from '@mastra/core/request-context';
import mongoose, { type Model } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type { PageDocument, PageModel } from '~/server/models/page';

import type { MastraRequestContextShape } from '../types/request-context';
import { getPageContentTool } from './get-page-content-tool';

// Integration test for the Mastra get-page-content tool.
//
// Approach: real MongoDB + real Page / Revision / User / UserGroup models.
// No Elasticsearch is involved — this tool only exercises the Page model's
// grant-aware finders (`findByIdAndViewer` / `findByPathAndViewer`) plus
// `populateDataToShowRevision` for the revision body.
//
// Setup mirrors `page.integ.ts` (canonical) and `full-text-search-tool.integ.ts`
// (sibling tool's integ pattern).

// Suppress logger noise from the tool body itself, matching sibling specs.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  }),
}));

// Per-worker prefix prevents path collisions when Vitest runs workers in
// parallel and also keeps fixtures from this suite separable from any
// developer / migration data already present in the test DB.
const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';

// Outline entry shape mirroring the tool's outputSchema. Mirrors the local
// definition used in `get-page-content-tool.spec.ts`.
type OutlineEntry = {
  line: number;
  level: number;
  heading: string;
};

// Content fields are optional: omitted in "outline mode" (offset omitted on a
// long page) and present in "content mode" (offset provided) or under the
// small-page optimization. `outline` is present only on the first call.
type GetPageContentOkResult = {
  result: 'ok';
  page: {
    path: string;
    updatedAt: string;
    totalLines: number;
    content?: string;
    offset?: number;
    limit?: number;
    hasMore?: boolean;
    outline?: OutlineEntry[];
  };
};

type GetPageContentFailureResult = {
  result: 'not_found_or_forbidden' | 'missing_input' | 'context_error';
  reason: string;
};

type GetPageContentResult =
  | GetPageContentOkResult
  | GetPageContentFailureResult;

// Helper to invoke the tool's execute the same way the Mastra runtime does.
// Narrows the return shape ONCE here so callers can branch on `result.result`
// without per-call casts. The two `as never` args are unavoidable: Mastra's
// `execute` signature uses `unknown` for both input and the context envelope.
const invokeExecute = async (
  inputData: {
    pageId?: string;
    pagePath?: string;
    offset?: number;
    limit?: number;
  },
  requestContext: RequestContext<MastraRequestContextShape>,
): Promise<GetPageContentResult> => {
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  const result = await getPageContentTool.execute!(
    inputData as never,
    { requestContext } as never,
  );
  return result as GetPageContentResult;
};

// Asserts the tool returned a success result and narrows the static type
// to `GetPageContentOkResult`. Replaces per-call `as GetPageContentOkResult`
// casts in callers — failure to receive `ok` fails the test loudly here.
function assertOk(
  result: GetPageContentResult,
): asserts result is GetPageContentOkResult {
  expect(result.result).toBe('ok');
}

// Asserts the tool returned a failure result and narrows the static type
// to `GetPageContentFailureResult`. Mirrors `assertOk` for the negative side
// so `result.reason` is statically available without a cast.
function assertFailure(
  result: GetPageContentResult,
): asserts result is GetPageContentFailureResult {
  expect(result.result).not.toBe('ok');
}

describe('getPageContentTool (integration)', () => {
  let Page: PageModel;
  let User: Model<IUserHasId>;
  let Revision: Model<{
    pageId: mongoose.Types.ObjectId;
    body: string;
    format: string;
    author: mongoose.Types.ObjectId;
  }>;
  let UserGroup: Model<{ name: string }>;
  let UserGroupRelation: Model<{
    relatedGroup: mongoose.Types.ObjectId;
    relatedUser: mongoose.Types.ObjectId;
  }>;

  let userA: IUserHasId;
  let userB: IUserHasId;
  let groupG: { _id: mongoose.Types.ObjectId };

  const pagePathPublic = `/get-page-content-integ/${WORKER_ID}/public`;
  const pagePathOwner = `/get-page-content-integ/${WORKER_ID}/owner`;
  const pagePathGroup = `/get-page-content-integ/${WORKER_ID}/group`;
  const pagePathRestricted = `/get-page-content-integ/${WORKER_ID}/restricted`;
  const pagePathLong = `/get-page-content-integ/${WORKER_ID}/long`;

  const bodyPublic = `Public page body for ${WORKER_ID}`;
  const bodyOwner = `Owner page body for ${WORKER_ID}`;
  const bodyGroup = `Group page body for ${WORKER_ID}`;
  const bodyRestricted = `Restricted page body for ${WORKER_ID}`;

  // Long-body page (300 lines) for offset/limit slicing + outline tests.
  // Headings are interleaved at line 50 / 150 / 250 so each heading sits at a
  // predictable position. Lines outside the heading positions are filler
  // (`Line N`) so `content.split('\n')[i]` is trivial to assert against.
  const LONG_PAGE_LINE_COUNT = 300;
  const longPageHeadingLines = [50, 150, 250] as const;
  const bodyLongLines = Array.from(
    { length: LONG_PAGE_LINE_COUNT },
    (_, i): string => {
      const lineNumber = i + 1;
      if (lineNumber === 50) return '# Section A';
      if (lineNumber === 150) return '## Section B';
      if (lineNumber === 250) return '### Section C';
      return `Line ${lineNumber}`;
    },
  );
  const bodyLong = bodyLongLines.join('\n');

  // Resolved page IDs for direct lookup assertions.
  let publicPageId: string;
  let ownerPageId: string;
  let groupPageId: string;
  let restrictedPageId: string;
  let longPageId: string;

  beforeAll(async () => {
    // getInstance() is called for its side effects (model registration,
    // configManager loading); the returned Crowi instance is not used here.
    await getInstance();

    // `mongoose.model(name)` without generics returns `Model<any>`. Passing
    // the document shape via the generic narrows it to the matching
    // `Model<T>` for User/Revision/UserGroup/UserGroupRelation without per-
    // call casts. Page keeps its `<PageDocument, PageModel>` form because
    // its schema methods are typed on `PageModel`.
    type RevisionDoc = {
      pageId: mongoose.Types.ObjectId;
      body: string;
      format: string;
      author: mongoose.Types.ObjectId;
    };
    type UserGroupRelationDoc = {
      relatedGroup: mongoose.Types.ObjectId;
      relatedUser: mongoose.Types.ObjectId;
    };
    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUserHasId>('User');
    Revision = mongoose.model<RevisionDoc>('Revision');
    UserGroup = mongoose.model<{ name: string }>('UserGroup');
    UserGroupRelation =
      mongoose.model<UserGroupRelationDoc>('UserGroupRelation');

    // Users: A (owner / group member) and B (non-owner / non-member).
    const userAName = `get-page-content-integ-userA-${WORKER_ID}`;
    const userBName = `get-page-content-integ-userB-${WORKER_ID}`;
    await User.deleteMany({ username: { $in: [userAName, userBName] } });
    const insertedUsers = await User.insertMany([
      {
        name: userAName,
        username: userAName,
        email: `${userAName}@example.com`,
      },
      {
        name: userBName,
        username: userBName,
        email: `${userBName}@example.com`,
      },
    ]);
    // `User` is typed as `Model<IUserHasId>`, so insertMany returns
    // `(IUserHasId & Document)[]` — already assignable to IUserHasId.
    userA = insertedUsers[0];
    userB = insertedUsers[1];

    // Group G containing only user A. User B is NOT a member.
    const groupName = `get-page-content-integ-group-${WORKER_ID}`;
    await UserGroup.deleteMany({ name: groupName });
    const insertedGroup = await UserGroup.create({ name: groupName });
    // Mongoose's `Document._id` is loosely typed from Model.create's return
    // shape; narrow to ObjectId via a single, scoped cast (the schema
    // guarantees this; we only use _id below).
    groupG = { _id: insertedGroup._id as mongoose.Types.ObjectId };
    await UserGroupRelation.deleteMany({ relatedGroup: groupG._id });
    await UserGroupRelation.create({
      relatedGroup: groupG._id,
      relatedUser: userA._id,
    });

    // Idempotency: wipe any leftover pages from a prior aborted run on this
    // worker (same paths). Revision cleanup is best-effort and orphaned
    // revisions are tolerated — populateDataToShowRevision only joins by
    // `revision` _id, not by `pageId`.
    await Page.deleteMany({
      path: {
        $in: [
          pagePathPublic,
          pagePathOwner,
          pagePathGroup,
          pagePathRestricted,
          pagePathLong,
        ],
      },
    });

    // Create pages first to obtain _id values, then create revisions and
    // link `page.revision = revision._id`. Mirrors the pattern used in
    // `full-text-search-tool.integ.ts`.
    const publicPage = await Page.create({
      path: pagePathPublic,
      grant: Page.GRANT_PUBLIC,
      creator: userA._id,
      lastUpdateUser: userA._id,
    });
    const ownerPage = await Page.create({
      path: pagePathOwner,
      grant: Page.GRANT_OWNER,
      grantedUsers: [userA._id],
      creator: userA._id,
      lastUpdateUser: userA._id,
    });
    const groupPage = await Page.create({
      path: pagePathGroup,
      grant: Page.GRANT_USER_GROUP,
      grantedUsers: [],
      grantedGroups: [{ item: groupG._id, type: 'UserGroup' }],
      creator: userA._id,
      lastUpdateUser: userA._id,
    });
    const restrictedPage = await Page.create({
      path: pagePathRestricted,
      grant: Page.GRANT_RESTRICTED,
      grantedUsers: [userA._id],
      creator: userA._id,
      lastUpdateUser: userA._id,
    });
    // Long-body PUBLIC page for slicing / outline tests (Task 3.6 C1, C2).
    // GRANT_PUBLIC keeps the focus on pagination semantics; grant-related
    // permutations are already exercised by the four pages above.
    const longPage = await Page.create({
      path: pagePathLong,
      grant: Page.GRANT_PUBLIC,
      creator: userA._id,
      lastUpdateUser: userA._id,
    });

    const revisions = await Revision.insertMany([
      {
        pageId: publicPage._id,
        body: bodyPublic,
        format: 'markdown',
        author: userA._id,
      },
      {
        pageId: ownerPage._id,
        body: bodyOwner,
        format: 'markdown',
        author: userA._id,
      },
      {
        pageId: groupPage._id,
        body: bodyGroup,
        format: 'markdown',
        author: userA._id,
      },
      {
        pageId: restrictedPage._id,
        body: bodyRestricted,
        format: 'markdown',
        author: userA._id,
      },
      {
        pageId: longPage._id,
        body: bodyLong,
        format: 'markdown',
        author: userA._id,
      },
    ]);

    publicPage.revision = revisions[0]._id;
    ownerPage.revision = revisions[1]._id;
    groupPage.revision = revisions[2]._id;
    restrictedPage.revision = revisions[3]._id;
    longPage.revision = revisions[4]._id;
    await publicPage.save();
    await ownerPage.save();
    await groupPage.save();
    await restrictedPage.save();
    await longPage.save();

    publicPageId = String(publicPage._id);
    ownerPageId = String(ownerPage._id);
    groupPageId = String(groupPage._id);
    restrictedPageId = String(restrictedPage._id);
    longPageId = String(longPage._id);
  }, 60_000);

  afterAll(async () => {
    // Best-effort cleanup: tolerate failures so teardown never masks
    // assertion errors. Each call is independently guarded.
    try {
      await Revision.deleteMany({
        pageId: {
          $in: [
            new mongoose.Types.ObjectId(publicPageId),
            new mongoose.Types.ObjectId(ownerPageId),
            new mongoose.Types.ObjectId(groupPageId),
            new mongoose.Types.ObjectId(restrictedPageId),
            new mongoose.Types.ObjectId(longPageId),
          ],
        },
      });
    } catch {
      // ignore
    }
    try {
      await Page.deleteMany({
        path: {
          $in: [
            pagePathPublic,
            pagePathOwner,
            pagePathGroup,
            pagePathRestricted,
            pagePathLong,
          ],
        },
      });
    } catch {
      // ignore
    }
    try {
      await UserGroupRelation.deleteMany({ relatedGroup: groupG?._id });
    } catch {
      // ignore
    }
    try {
      await UserGroup.deleteMany({ _id: groupG?._id });
    } catch {
      // ignore
    }
    try {
      await User.deleteMany({
        _id: { $in: [userA?._id, userB?._id] },
      });
    } catch {
      // ignore
    }
  }, 30_000);

  const buildRequestContext = (
    user: IUserHasId,
  ): RequestContext<MastraRequestContextShape> => {
    const ctx = new RequestContext<MastraRequestContextShape>();
    ctx.set('user', user);
    return ctx;
  };

  // Shared expectations for short single-line seeds (bodyPublic, bodyOwner,
  // bodyGroup, bodyRestricted). After Task 3.4 the output schema renames
  // `body` → `content` and adds `totalLines` / `offset` / `limit` / `hasMore`
  // plus an auto-included `outline`. None of these seeds contain headings, so
  // `outline === []` is the expected sentinel (distinct from `undefined`).
  const assertShortSeedShape = (
    ok: GetPageContentOkResult,
    expectedBody: string,
  ): void => {
    expect(ok.page.content).toBe(expectedBody);
    expect(ok.page.totalLines).toBe(1);
    expect(ok.page.offset).toBe(1);
    expect(ok.page.limit).toBe(200);
    expect(ok.page.hasMore).toBe(false);
    // `offset` is omitted by every short-seed call site below, so the tool
    // auto-includes the outline. Empty bodies-of-headings yield `[]` — this
    // is the contract that lets agents distinguish "outline missing" from
    // "outline present but no headings".
    expect(ok.page.outline).toEqual([]);
  };

  describe('GRANT_PUBLIC', () => {
    it('returns ok with content and path for the owning user (A) via pageId', async () => {
      const result = await invokeExecute(
        { pageId: publicPageId },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathPublic);
      assertShortSeedShape(result, bodyPublic);
      // updatedAt is the page's updatedAt (Date.toISOString() format).
      expect(result.page.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns ok for a non-owner user (B) via pageId (PUBLIC is visible to all viewers)', async () => {
      const result = await invokeExecute(
        { pageId: publicPageId },
        buildRequestContext(userB),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathPublic);
      assertShortSeedShape(result, bodyPublic);
    });
  });

  describe('GRANT_OWNER', () => {
    it('returns ok for the owner (A) via pageId', async () => {
      const result = await invokeExecute(
        { pageId: ownerPageId },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathOwner);
      assertShortSeedShape(result, bodyOwner);
    });

    it('returns not_found_or_forbidden for a non-owner (B) via pageId', async () => {
      const result = await invokeExecute(
        { pageId: ownerPageId },
        buildRequestContext(userB),
      );

      assertFailure(result);
      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('GRANT_USER_GROUP', () => {
    it('returns ok for a group member (A) via pageId', async () => {
      const result = await invokeExecute(
        { pageId: groupPageId },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathGroup);
      assertShortSeedShape(result, bodyGroup);
    });

    it('returns not_found_or_forbidden for a non-member (B) via pageId', async () => {
      const result = await invokeExecute(
        { pageId: groupPageId },
        buildRequestContext(userB),
      );

      assertFailure(result);
      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('GRANT_RESTRICTED (link-share)', () => {
    it('returns ok for the page owner (A) via pageId', async () => {
      const result = await invokeExecute(
        { pageId: restrictedPageId },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathRestricted);
      assertShortSeedShape(result, bodyRestricted);
    });

    // Existing-behavior assertion (design.md ~line 812, research R-3):
    // `findByIdAndViewer` passes `includeAnyoneWithTheLink = true` to the
    // PageQueryBuilder (see page.ts line 715), so GRANT_RESTRICTED pages are
    // retrievable by any authenticated viewer when the pageId is known. The
    // tool inherits this existing behavior — it does NOT enforce its own
    // grant logic (requirement 2.7).
    it('returns ok for a non-owner (B) via pageId (link-share behavior of findByIdAndViewer)', async () => {
      const result = await invokeExecute(
        { pageId: restrictedPageId },
        buildRequestContext(userB),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathRestricted);
      assertShortSeedShape(result, bodyRestricted);
    });

    // Path-based lookup uses `findByPathAndViewer` with `useFindOne = true`,
    // which internally sets `includeAnyoneWithTheLink = useFindOne = true`
    // (see page.ts line 841). Same documented behavior as the pageId path.
    it('returns ok for a non-owner (B) via pagePath (link-share behavior of findByPathAndViewer)', async () => {
      const result = await invokeExecute(
        { pagePath: pagePathRestricted },
        buildRequestContext(userB),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathRestricted);
      assertShortSeedShape(result, bodyRestricted);
    });
  });

  describe('non-existent page', () => {
    it('returns not_found_or_forbidden for a random non-existent ObjectId via pageId', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const result = await invokeExecute(
        { pageId: nonExistentId },
        buildRequestContext(userA),
      );

      assertFailure(result);
      // Cannot be distinguished from "no permission" — this is the design
      // intent for information-leak prevention (design.md Security section).
      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });

    it('returns not_found_or_forbidden for an unknown pagePath via pagePath', async () => {
      const nonExistentPath = `/get-page-content-integ/${WORKER_ID}/does-not-exist-${Date.now()}`;

      const result = await invokeExecute(
        { pagePath: nonExistentPath },
        buildRequestContext(userA),
      );

      assertFailure(result);
      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('pagePath lookup with grant enforcement', () => {
    it('returns ok for the GRANT_PUBLIC page via pagePath (both users)', async () => {
      const resultForA = await invokeExecute(
        { pagePath: pagePathPublic },
        buildRequestContext(userA),
      );
      const resultForB = await invokeExecute(
        { pagePath: pagePathPublic },
        buildRequestContext(userB),
      );

      assertOk(resultForA);
      assertOk(resultForB);
      expect(resultForA.page.path).toBe(pagePathPublic);
      assertShortSeedShape(resultForA, bodyPublic);
      expect(resultForB.page.path).toBe(pagePathPublic);
      assertShortSeedShape(resultForB, bodyPublic);
    });

    it('returns ok for the GRANT_OWNER page via pagePath for owner (A) but not_found_or_forbidden for non-owner (B)', async () => {
      const resultForA = await invokeExecute(
        { pagePath: pagePathOwner },
        buildRequestContext(userA),
      );
      const resultForB = await invokeExecute(
        { pagePath: pagePathOwner },
        buildRequestContext(userB),
      );

      assertOk(resultForA);
      assertFailure(resultForB);
      expect(resultForA.page.path).toBe(pagePathOwner);
      assertShortSeedShape(resultForA, bodyOwner);
      expect(resultForB.result).toBe('not_found_or_forbidden');
    });

    it('returns ok for the GRANT_USER_GROUP page via pagePath for member (A) but not_found_or_forbidden for non-member (B)', async () => {
      const resultForA = await invokeExecute(
        { pagePath: pagePathGroup },
        buildRequestContext(userA),
      );
      const resultForB = await invokeExecute(
        { pagePath: pagePathGroup },
        buildRequestContext(userB),
      );

      assertOk(resultForA);
      assertFailure(resultForB);
      expect(resultForA.page.path).toBe(pagePathGroup);
      assertShortSeedShape(resultForA, bodyGroup);
      expect(resultForB.result).toBe('not_found_or_forbidden');
    });
  });

  // Long-body page exercises the outline/content mode split through the real
  // Page / Revision lookup path. The same seed (300 lines, headings at lines
  // 50 / 150 / 250) drives both cases — paired so the outline-mode test can
  // reference the heading layout that drove the content-mode slicing test.
  describe('long-body page (content mode slicing + outline mode)', () => {
    it('content mode: returns the requested slice (lines 200-299) with hasMore=true and outline undefined when offset is provided', async () => {
      const result = await invokeExecute(
        { pageId: longPageId, offset: 200, limit: 100 },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathLong);

      // Slice math: startIdx = 199, sliced.length = 100, endIdx = 299.
      // hasMore = (299 < 300) = true — line "Line 300" remains unread.
      const { content } = result.page;
      if (content == null) throw new Error('expected content in content mode');
      const lines = content.split('\n');
      expect(lines).toHaveLength(100);
      // Line 200 is filler (`Line 200`); line 250 sits at a heading position.
      expect(lines[0]).toBe('Line 200');
      // Last line of the slice corresponds to body line 299 (1-indexed),
      // i.e. `Line 299` filler.
      expect(lines[lines.length - 1]).toBe('Line 299');
      // Heading at line 250 lands at array index 50 within the returned slice
      // (250 - 200). Use this as a spot-check that the seed indexing is sane.
      expect(lines[50]).toBe('### Section C');

      expect(result.page.totalLines).toBe(LONG_PAGE_LINE_COUNT);
      expect(result.page.offset).toBe(200);
      expect(result.page.limit).toBe(100);
      expect(result.page.hasMore).toBe(true);
      // content mode (offset provided) → outline must be omitted entirely
      // (requirement 2.8 / 2.9).
      expect(result.page.outline).toBeUndefined();
    });

    it('outline mode: returns outline only (no content fields) when offset is omitted on a long page (totalLines > limit)', async () => {
      const result = await invokeExecute(
        { pageId: longPageId },
        buildRequestContext(userA),
      );

      assertOk(result);
      expect(result.page.path).toBe(pagePathLong);

      // totalLines (300) > default limit (200) → outline mode: the body is
      // NOT returned. The agent must drill in via an explicit offset.
      expect(result.page.totalLines).toBe(LONG_PAGE_LINE_COUNT);
      expect(result.page.content).toBeUndefined();
      expect(result.page.offset).toBeUndefined();
      expect(result.page.limit).toBeUndefined();
      expect(result.page.hasMore).toBeUndefined();

      // The outline reflects every heading in the FULL body so an agent can
      // decide where to drill next.
      expect(result.page.outline).toEqual([
        { line: longPageHeadingLines[0], level: 1, heading: 'Section A' },
        { line: longPageHeadingLines[1], level: 2, heading: 'Section B' },
        { line: longPageHeadingLines[2], level: 3, heading: 'Section C' },
      ]);
    });
  });
});
