import type { IUser } from '@growi/core';
import expressFactory, { type Express } from 'express';
import mongoose, { type HydratedDocument, type Model } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

/**
 * Route-level integration test for Task 5.3: the $lsx `tag` option must
 * reach the REAL production wiring in `crowi/index.ts` --
 * `lsxRoutes(this, this.express, { resolveTagPageIds: (tagNames) =>
 * prisma.pagetagrelations.findPageIdsWithAllTags(tagNames) })` -- and the
 * resulting `/_api/lsx` route must apply both the tag condition AND the
 * existing viewer/permission filter together.
 *
 * Approach: build a real `Crowi` instance (via the shared `getInstance()`
 * test helper, same as page-markdown.integ.ts) and call its OWN
 * `setupRoutesForPlugins()` method -- this is the exact method under
 * change for this task -- against a real Express app. Nothing about the
 * lsx route registration is reimplemented here; the only thing this file
 * adds is a real MongoDB Page/Tag/PageTagRelation fixture, a `req.user`
 * injector (standing in for session/PAT resolution, same convention as
 * other route-level integ tests here), and HTTP requests via supertest.
 */

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const TAG_PREFIX = `lsx-wiring-${WORKER_ID}-`;
const TAG_NAME = `${TAG_PREFIX}tag`;
const BASE_PATH = `/lsx-wiring-${WORKER_ID}`;

describe('crowi.setupRoutesForPlugins() -> $lsx tag wiring (integration)', () => {
  let crowi: Crowi;
  let app: Express;
  let Page: PageModel;
  let User: Model<IUser>;

  let testUser: HydratedDocument<IUser>;
  let otherUser: HydratedDocument<IUser>;
  let currentUser: HydratedDocument<IUser> | undefined;

  let visiblePageId: string;
  let hiddenPageId: string;
  let tagId: string;

  const createdPageIds: string[] = [];

  let originalCrowiExpress: Express | undefined;

  beforeAll(async () => {
    crowi = await getInstance();

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model<IUser>('User');

    const testUserName = `lsx-wiring-user-${WORKER_ID}`;
    const otherUserName = `lsx-wiring-other-${WORKER_ID}`;
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

    await Page.deleteMany({ path: { $regex: `^${BASE_PATH}` } });

    // one page the current viewer (testUser) CAN see, one they CANNOT --
    // both tagged with the same tag, so the only thing that can explain a
    // difference in the response is the viewer-permission filter.
    const visiblePage = await Page.create({
      path: `${BASE_PATH}/visible`,
      grant: Page.GRANT_PUBLIC,
      creator: testUser._id,
      lastUpdateUser: testUser._id,
      isEmpty: false,
      descendantCount: 0,
    });
    const hiddenPage = await Page.create({
      path: `${BASE_PATH}/hidden`,
      grant: Page.GRANT_OWNER,
      grantedUsers: [otherUser._id],
      creator: otherUser._id,
      lastUpdateUser: otherUser._id,
      isEmpty: false,
      descendantCount: 0,
    });
    visiblePageId = visiblePage._id.toString();
    hiddenPageId = hiddenPage._id.toString();
    createdPageIds.push(visiblePageId, hiddenPageId);

    await prisma.pagetagrelations.deleteMany({
      where: { relatedPageId: { in: createdPageIds } },
    });
    await prisma.tags.deleteMany({ where: { name: TAG_NAME } });
    await prisma.tags.create({ data: { name: TAG_NAME } });
    const tag = await prisma.tags.findFirst({ where: { name: TAG_NAME } });
    if (tag == null) {
      throw new Error('failed to seed the fixture tag');
    }
    tagId = tag.id;
    await prisma.pagetagrelations.createMany({
      data: createdPageIds.map((relatedPageId) => ({
        relatedPageId,
        relatedTagId: tagId,
      })),
    });

    // Build a fresh Express app and delegate route registration to the
    // REAL production method under test -- crowi/index.ts's
    // setupRoutesForPlugins(). This is deliberately NOT a hand-rolled call
    // to `lsxRoutes(...)`: that would bypass the very wiring this task adds.
    app = expressFactory();
    app.use(expressFactory.json());
    app.use((req: CrowiRequest, _res, next) => {
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    // Capture the Crowi singleton's original `express` before overwriting it --
    // `getInstance()` returns the SAME Crowi instance to every `.integ.ts` file
    // sharing this Vitest worker for the life of the worker, so this mutation
    // must be restored in `afterAll` (mirrors the
    // `security:list-policy:hideRestrictedByOwner` capture/restore below).
    originalCrowiExpress = crowi.express;
    crowi.express = app;
    crowi.setupRoutesForPlugins();

    // By default GROWI's list views show the EXISTENCE of a GRANT_OWNER
    // page to any viewer (only its content stays hidden) -- see
    // `security:list-policy:hideRestrictedByOwner` (default false). Turning
    // it on is what makes an owner-restricted page actually disappear from
    // a listing for a non-owner, which is what this test needs to prove the
    // tag condition and the viewer-permission filter compose together
    // (same override used by bookmarks.integ.ts for the same reason).
    await configManager.updateConfig(
      'security:list-policy:hideRestrictedByOwner',
      true,
      { skipPubsub: true },
    );
  }, 60_000);

  afterAll(async () => {
    try {
      await Page.deleteMany({ _id: { $in: createdPageIds } });
    } catch {
      // ignore
    }
    try {
      await prisma.pagetagrelations.deleteMany({
        where: { relatedPageId: { in: createdPageIds } },
      });
      await prisma.tags.deleteMany({ where: { name: TAG_NAME } });
    } catch {
      // ignore
    }
    try {
      await User.deleteMany({ _id: { $in: [testUser?._id, otherUser?._id] } });
    } catch {
      // ignore
    }
    try {
      await configManager.updateConfig(
        'security:list-policy:hideRestrictedByOwner',
        false,
        { skipPubsub: true },
      );
    } catch {
      // ignore
    }
    // `Crowi#express` is declared `express!: Express` (definite-assignment
    // assertion), so its declared type lies about nullability -- at this point
    // in the test lifecycle it is genuinely `Express | undefined`. Cast (not
    // `as any`) to restore the real captured value onto that field.
    crowi.express = originalCrowiExpress as Express;
  }, 30_000);

  beforeEach(() => {
    currentUser = testUser;
  });

  it('resolves the tag through the real production resolver end-to-end, and stays compatible with the existing viewer-permission filter (Req 1.1, 1.2, 1.3; supporting evidence for 3.1, 3.2 -- see task 6.1 for dedicated depth)', async () => {
    const res = await request(app)
      .get('/_api/lsx')
      .query({
        pagePath: BASE_PATH,
        options: JSON.stringify({ tag: TAG_NAME }),
      });

    expect(res.status).toBe(200);
    const paths = res.body.pages.map((p: { path: string }) => p.path);

    // the tagged page testUser can view is included
    expect(paths).toContain(`${BASE_PATH}/visible`);
    // the tagged page testUser cannot view is excluded, even though it
    // matches the tag condition
    expect(paths).not.toContain(`${BASE_PATH}/hidden`);
    expect(res.body.total).toBe(1);

    // Positive control: the SAME hidden page, under the SAME tag condition,
    // DOES appear for otherUser -- the user it was granted to. This isolates
    // the exclusion above to the viewer-permission filter specifically,
    // rather than some incidental fixture detail (e.g. the page being
    // unlisted for everyone, or the tag relation not actually covering it).
    currentUser = otherUser;
    const resAsOwner = await request(app)
      .get('/_api/lsx')
      .query({
        pagePath: BASE_PATH,
        options: JSON.stringify({ tag: TAG_NAME }),
      });

    expect(resAsOwner.status).toBe(200);
    const pathsAsOwner = resAsOwner.body.pages.map(
      (p: { path: string }) => p.path,
    );
    expect(pathsAsOwner).toContain(`${BASE_PATH}/hidden`);
    expect(pathsAsOwner).toContain(`${BASE_PATH}/visible`);
    expect(resAsOwner.body.total).toBe(2);
  });

  it('returns an empty list for a tag name that does not exist on the wiki (Req 1.4, 1.5)', async () => {
    const res = await request(app)
      .get('/_api/lsx')
      .query({
        pagePath: BASE_PATH,
        options: JSON.stringify({ tag: `${TAG_PREFIX}does-not-exist` }),
      });

    expect(res.status).toBe(200);
    expect(res.body.pages).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  /**
   * Task 6.1 -- dedicated Requirement 3.1/3.2 depth.
   *
   * The test above (task 5.3) already proves the tag condition and the
   * viewer-permission filter compose, using ONE restricted page under
   * GRANT_OWNER. This block adds coverage that test does not provide:
   *
   * - THREE pages under one tag, where only SOME are visible to the
   *   requesting viewer, asserting the exact resulting set (not just
   *   "the one visible page is present / the one hidden page is absent").
   * - An explicit assertion on `total` (the response's count field), since
   *   Requirement 3.2 explicitly requires exclusion from BOTH "一覧"
   *   (the list) AND "件数" (the count).
   * - A DIFFERENT grant/restriction mechanism (GRANT_USER_GROUP, gated by
   *   `security:list-policy:hideRestrictedByGroup`) rather than another
   *   GRANT_OWNER variant, so this test exercises a genuinely different
   *   path through `addConditionToFilteringByViewerForList` than task
   *   5.3's test does. Fixture shape follows the group-restricted-page
   *   pattern already used by `apps/app/src/server/routes/apiv3/bookmarks.integ.ts`.
   */
  describe('multiple pages under one tag, some group-restricted (Req 3.1, 3.2)', () => {
    const GROUP_BASE_PATH = `${BASE_PATH}/group-scenario`;
    const GROUP_TAG_NAME = `${TAG_PREFIX}group-scenario`;

    let UserGroup: Model<{ name: string }>;
    let UserGroupRelation: Model<{
      relatedGroup: mongoose.Types.ObjectId;
      relatedUser: mongoose.Types.ObjectId;
    }>;

    let memberUser: HydratedDocument<IUser>;
    let group: HydratedDocument<{ name: string }>;

    let visiblePageId1: string;
    let visiblePageId2: string;
    let hiddenGroupPageId: string;
    const groupScenarioPageIds: string[] = [];

    beforeAll(async () => {
      UserGroup = mongoose.model<{ name: string }>('UserGroup');
      UserGroupRelation = mongoose.model<{
        relatedGroup: mongoose.Types.ObjectId;
        relatedUser: mongoose.Types.ObjectId;
      }>('UserGroupRelation');

      const memberUserName = `lsx-wiring-group-member-${WORKER_ID}`;
      await User.deleteMany({ username: memberUserName });
      memberUser = await User.create({
        name: memberUserName,
        username: memberUserName,
        email: `${memberUserName}@example.com`,
      });

      await UserGroup.deleteMany({ name: `lsx-wiring-group-${WORKER_ID}` });
      [group] = await UserGroup.insertMany([
        { name: `lsx-wiring-group-${WORKER_ID}` },
      ]);
      await UserGroupRelation.insertMany([
        { relatedGroup: group._id, relatedUser: memberUser._id },
      ]);

      await Page.deleteMany({ path: { $regex: `^${GROUP_BASE_PATH}` } });
      const visiblePage1 = await Page.create({
        path: `${GROUP_BASE_PATH}/visible-1`,
        grant: Page.GRANT_PUBLIC,
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        isEmpty: false,
        descendantCount: 0,
      });
      const visiblePage2 = await Page.create({
        path: `${GROUP_BASE_PATH}/visible-2`,
        grant: Page.GRANT_PUBLIC,
        creator: testUser._id,
        lastUpdateUser: testUser._id,
        isEmpty: false,
        descendantCount: 0,
      });
      const hiddenGroupPage = await Page.create({
        path: `${GROUP_BASE_PATH}/hidden-group`,
        grant: Page.GRANT_USER_GROUP,
        grantedGroups: [{ item: group._id, type: 'UserGroup' }],
        creator: memberUser._id,
        lastUpdateUser: memberUser._id,
        isEmpty: false,
        descendantCount: 0,
      });
      visiblePageId1 = visiblePage1._id.toString();
      visiblePageId2 = visiblePage2._id.toString();
      hiddenGroupPageId = hiddenGroupPage._id.toString();
      groupScenarioPageIds.push(
        visiblePageId1,
        visiblePageId2,
        hiddenGroupPageId,
      );

      await prisma.pagetagrelations.deleteMany({
        where: { relatedPageId: { in: groupScenarioPageIds } },
      });
      await prisma.tags.deleteMany({ where: { name: GROUP_TAG_NAME } });
      await prisma.tags.create({ data: { name: GROUP_TAG_NAME } });
      const groupTag = await prisma.tags.findFirst({
        where: { name: GROUP_TAG_NAME },
      });
      if (groupTag == null) {
        throw new Error('failed to seed the group-scenario fixture tag');
      }
      await prisma.pagetagrelations.createMany({
        data: groupScenarioPageIds.map((relatedPageId) => ({
          relatedPageId,
          relatedTagId: groupTag.id,
        })),
      });

      // By default GROWI's list views show the EXISTENCE of a
      // GRANT_USER_GROUP page to any viewer (only its content stays
      // hidden) -- same rationale as `hideRestrictedByOwner` above, but
      // the group-scope counterpart config key (see bookmarks.integ.ts).
      // (Default is `false`, mirrored by the `afterAll` restore below --
      // same convention as the outer describe's `hideRestrictedByOwner`.)
      await configManager.updateConfig(
        'security:list-policy:hideRestrictedByGroup',
        true,
        { skipPubsub: true },
      );
    }, 60_000);

    afterAll(async () => {
      try {
        await Page.deleteMany({ _id: { $in: groupScenarioPageIds } });
      } catch {
        // ignore
      }
      try {
        await prisma.pagetagrelations.deleteMany({
          where: { relatedPageId: { in: groupScenarioPageIds } },
        });
        await prisma.tags.deleteMany({ where: { name: GROUP_TAG_NAME } });
      } catch {
        // ignore
      }
      try {
        await UserGroupRelation.deleteMany({ relatedGroup: group._id });
        await UserGroup.deleteMany({ _id: group._id });
      } catch {
        // ignore
      }
      try {
        await User.deleteMany({ _id: memberUser?._id });
      } catch {
        // ignore
      }
      try {
        await configManager.updateConfig(
          'security:list-policy:hideRestrictedByGroup',
          false,
          { skipPubsub: true },
        );
      } catch {
        // ignore
      }
    }, 30_000);

    it('excludes the group-restricted page from BOTH the returned list AND the total count for a non-member, while including it for a member (Req 3.1, 3.2)', async () => {
      currentUser = testUser; // not a member of `group`

      const res = await request(app)
        .get('/_api/lsx')
        .query({
          pagePath: GROUP_BASE_PATH,
          options: JSON.stringify({ tag: GROUP_TAG_NAME }),
        });

      expect(res.status).toBe(200);
      const paths = res.body.pages
        .map((p: { path: string }) => p.path)
        .toSorted();
      // Assert the EXACT resulting set, not just "one page is present" --
      // this is the multi-page breadth 5.3's single-restricted-page test
      // does not cover.
      expect(paths).toEqual([
        `${GROUP_BASE_PATH}/visible-1`,
        `${GROUP_BASE_PATH}/visible-2`,
      ]);
      // Requirement 3.2 requires exclusion from both the list AND the
      // count -- assert `total` explicitly, not only the `pages` array.
      expect(res.body.total).toBe(2);

      // Positive control: the SAME group-restricted page, under the SAME
      // tag condition, appears for a member of the granted group -- this
      // isolates the exclusion above to the group-permission filter.
      currentUser = memberUser;
      const resAsMember = await request(app)
        .get('/_api/lsx')
        .query({
          pagePath: GROUP_BASE_PATH,
          options: JSON.stringify({ tag: GROUP_TAG_NAME }),
        });

      expect(resAsMember.status).toBe(200);
      const pathsAsMember = resAsMember.body.pages
        .map((p: { path: string }) => p.path)
        .toSorted();
      expect(pathsAsMember).toEqual([
        `${GROUP_BASE_PATH}/hidden-group`,
        `${GROUP_BASE_PATH}/visible-1`,
        `${GROUP_BASE_PATH}/visible-2`,
      ]);
      expect(resAsMember.body.total).toBe(3);
    });
  });
});
