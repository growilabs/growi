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

type GetPageContentOkResult = {
  result: 'ok';
  page: { path: string; body: string; updatedAt: string };
};

type GetPageContentFailureResult = {
  result: 'not_found_or_forbidden' | 'missing_input' | 'context_error';
  reason: string;
};

type GetPageContentResult =
  | GetPageContentOkResult
  | GetPageContentFailureResult;

// Helper to invoke the tool's execute the same way the Mastra runtime does.
const invokeExecute = (
  inputData: { pageId?: string; pagePath?: string },
  requestContext: RequestContext<MastraRequestContextShape>,
): Promise<GetPageContentResult> => {
  // biome-ignore lint/style/noNonNullAssertion: createTool always wires execute
  return getPageContentTool.execute!(
    inputData as never,
    {
      requestContext,
    } as never,
  ) as Promise<GetPageContentResult>;
};

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

  const bodyPublic = `Public page body for ${WORKER_ID}`;
  const bodyOwner = `Owner page body for ${WORKER_ID}`;
  const bodyGroup = `Group page body for ${WORKER_ID}`;
  const bodyRestricted = `Restricted page body for ${WORKER_ID}`;

  // Resolved page IDs for direct lookup assertions.
  let publicPageId: string;
  let ownerPageId: string;
  let groupPageId: string;
  let restrictedPageId: string;

  beforeAll(async () => {
    // getInstance() is called for its side effects (model registration,
    // configManager loading); the returned Crowi instance is not used here.
    await getInstance();

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User') as unknown as typeof User;
    Revision = mongoose.model('Revision') as unknown as typeof Revision;
    UserGroup = mongoose.model('UserGroup') as unknown as typeof UserGroup;
    UserGroupRelation = mongoose.model(
      'UserGroupRelation',
    ) as unknown as typeof UserGroupRelation;

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
    userA = insertedUsers[0] as unknown as IUserHasId;
    userB = insertedUsers[1] as unknown as IUserHasId;

    // Group G containing only user A. User B is NOT a member.
    const groupName = `get-page-content-integ-group-${WORKER_ID}`;
    await UserGroup.deleteMany({ name: groupName });
    const insertedGroup = await UserGroup.create({ name: groupName });
    groupG = insertedGroup as unknown as { _id: mongoose.Types.ObjectId };
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
        $in: [pagePathPublic, pagePathOwner, pagePathGroup, pagePathRestricted],
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
    ]);

    publicPage.revision = revisions[0]._id;
    ownerPage.revision = revisions[1]._id;
    groupPage.revision = revisions[2]._id;
    restrictedPage.revision = revisions[3]._id;
    await publicPage.save();
    await ownerPage.save();
    await groupPage.save();
    await restrictedPage.save();

    publicPageId = String(publicPage._id);
    ownerPageId = String(ownerPage._id);
    groupPageId = String(groupPage._id);
    restrictedPageId = String(restrictedPage._id);
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

  describe('GRANT_PUBLIC', () => {
    it('returns ok with body and path for the owning user (A) via pageId', async () => {
      const result = (await invokeExecute(
        { pageId: publicPageId },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathPublic);
      expect(result.page.body).toBe(bodyPublic);
      // updatedAt is the page's updatedAt (Date.toISOString() format).
      expect(result.page.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns ok for a non-owner user (B) via pageId (PUBLIC is visible to all viewers)', async () => {
      const result = (await invokeExecute(
        { pageId: publicPageId },
        buildRequestContext(userB),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathPublic);
      expect(result.page.body).toBe(bodyPublic);
    });
  });

  describe('GRANT_OWNER', () => {
    it('returns ok for the owner (A) via pageId', async () => {
      const result = (await invokeExecute(
        { pageId: ownerPageId },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathOwner);
      expect(result.page.body).toBe(bodyOwner);
    });

    it('returns not_found_or_forbidden for a non-owner (B) via pageId', async () => {
      const result = (await invokeExecute(
        { pageId: ownerPageId },
        buildRequestContext(userB),
      )) as GetPageContentFailureResult;

      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('GRANT_USER_GROUP', () => {
    it('returns ok for a group member (A) via pageId', async () => {
      const result = (await invokeExecute(
        { pageId: groupPageId },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathGroup);
      expect(result.page.body).toBe(bodyGroup);
    });

    it('returns not_found_or_forbidden for a non-member (B) via pageId', async () => {
      const result = (await invokeExecute(
        { pageId: groupPageId },
        buildRequestContext(userB),
      )) as GetPageContentFailureResult;

      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('GRANT_RESTRICTED (link-share)', () => {
    it('returns ok for the page owner (A) via pageId', async () => {
      const result = (await invokeExecute(
        { pageId: restrictedPageId },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathRestricted);
      expect(result.page.body).toBe(bodyRestricted);
    });

    // Existing-behavior assertion (design.md ~line 812, research R-3):
    // `findByIdAndViewer` passes `includeAnyoneWithTheLink = true` to the
    // PageQueryBuilder (see page.ts line 715), so GRANT_RESTRICTED pages are
    // retrievable by any authenticated viewer when the pageId is known. The
    // tool inherits this existing behavior — it does NOT enforce its own
    // grant logic (requirement 2.7).
    it('returns ok for a non-owner (B) via pageId (link-share behavior of findByIdAndViewer)', async () => {
      const result = (await invokeExecute(
        { pageId: restrictedPageId },
        buildRequestContext(userB),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathRestricted);
      expect(result.page.body).toBe(bodyRestricted);
    });

    // Path-based lookup uses `findByPathAndViewer` with `useFindOne = true`,
    // which internally sets `includeAnyoneWithTheLink = useFindOne = true`
    // (see page.ts line 841). Same documented behavior as the pageId path.
    it('returns ok for a non-owner (B) via pagePath (link-share behavior of findByPathAndViewer)', async () => {
      const result = (await invokeExecute(
        { pagePath: pagePathRestricted },
        buildRequestContext(userB),
      )) as GetPageContentOkResult;

      expect(result.result).toBe('ok');
      expect(result.page.path).toBe(pagePathRestricted);
      expect(result.page.body).toBe(bodyRestricted);
    });
  });

  describe('non-existent page', () => {
    it('returns not_found_or_forbidden for a random non-existent ObjectId via pageId', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const result = (await invokeExecute(
        { pageId: nonExistentId },
        buildRequestContext(userA),
      )) as GetPageContentFailureResult;

      // Cannot be distinguished from "no permission" — this is the design
      // intent for information-leak prevention (design.md Security section).
      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });

    it('returns not_found_or_forbidden for an unknown pagePath via pagePath', async () => {
      const nonExistentPath = `/get-page-content-integ/${WORKER_ID}/does-not-exist-${Date.now()}`;

      const result = (await invokeExecute(
        { pagePath: nonExistentPath },
        buildRequestContext(userA),
      )) as GetPageContentFailureResult;

      expect(result.result).toBe('not_found_or_forbidden');
      expect(typeof result.reason).toBe('string');
    });
  });

  describe('pagePath lookup with grant enforcement', () => {
    it('returns ok for the GRANT_PUBLIC page via pagePath (both users)', async () => {
      const resultForA = (await invokeExecute(
        { pagePath: pagePathPublic },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;
      const resultForB = (await invokeExecute(
        { pagePath: pagePathPublic },
        buildRequestContext(userB),
      )) as GetPageContentOkResult;

      expect(resultForA.result).toBe('ok');
      expect(resultForA.page.path).toBe(pagePathPublic);
      expect(resultForA.page.body).toBe(bodyPublic);
      expect(resultForB.result).toBe('ok');
      expect(resultForB.page.path).toBe(pagePathPublic);
      expect(resultForB.page.body).toBe(bodyPublic);
    });

    it('returns ok for the GRANT_OWNER page via pagePath for owner (A) but not_found_or_forbidden for non-owner (B)', async () => {
      const resultForA = (await invokeExecute(
        { pagePath: pagePathOwner },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;
      const resultForB = (await invokeExecute(
        { pagePath: pagePathOwner },
        buildRequestContext(userB),
      )) as GetPageContentFailureResult;

      expect(resultForA.result).toBe('ok');
      expect(resultForA.page.path).toBe(pagePathOwner);
      expect(resultForA.page.body).toBe(bodyOwner);
      expect(resultForB.result).toBe('not_found_or_forbidden');
    });

    it('returns ok for the GRANT_USER_GROUP page via pagePath for member (A) but not_found_or_forbidden for non-member (B)', async () => {
      const resultForA = (await invokeExecute(
        { pagePath: pagePathGroup },
        buildRequestContext(userA),
      )) as GetPageContentOkResult;
      const resultForB = (await invokeExecute(
        { pagePath: pagePathGroup },
        buildRequestContext(userB),
      )) as GetPageContentFailureResult;

      expect(resultForA.result).toBe('ok');
      expect(resultForA.page.path).toBe(pagePathGroup);
      expect(resultForA.page.body).toBe(bodyGroup);
      expect(resultForB.result).toBe('not_found_or_forbidden');
    });
  });
});
