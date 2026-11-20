import type { IUserHasId } from '@growi/core/dist/interfaces';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { Prisma } from '~/generated/prisma/client';
import {
  ActivityLogActions,
  type SupportedActivityActionType,
} from '~/interfaces/activity';
import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import {
  assertIsArray,
  normalizeAggregateRaw,
} from '~/server/util/prisma-raw-normalize';
import { prisma } from '~/utils/prisma';

import {
  aggregateUserActivities,
  type UserActivityRow,
} from './aggregate-user-activities';
import { buildListablePageFilter } from './build-listable-page-filter';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_PREFIX = `/build-listable-page-filter-integ-${WORKER_ID}`;

const GRANT_PUBLIC = 1;
const GRANT_RESTRICTED = 2;
const GRANT_OWNER = 4;
const GRANT_USER_GROUP = 5;

const POLICY_COMBINATIONS: ListPolicy[] = [
  { hideRestrictedByOwner: false, hideRestrictedByGroup: false },
  { hideRestrictedByOwner: true, hideRestrictedByGroup: false },
  { hideRestrictedByOwner: false, hideRestrictedByGroup: true },
  { hideRestrictedByOwner: true, hideRestrictedByGroup: true },
];

type ListPolicy = {
  hideRestrictedByOwner: boolean;
  hideRestrictedByGroup: boolean;
};

const setListPolicy = async (policy: ListPolicy): Promise<void> => {
  await configManager.updateConfigs(
    {
      'security:list-policy:hideRestrictedByOwner':
        policy.hideRestrictedByOwner,
      'security:list-policy:hideRestrictedByGroup':
        policy.hideRestrictedByGroup,
    },
    { skipPubsub: true },
  );
};

// Seeded through the driver so that an absent `wip` field stays absent.
const pagesCollection = () => mongoose.connection.collection('pages');

describe('buildListablePageFilter', () => {
  const viewerId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const viewerGroupId = new Types.ObjectId();
  const viewerExternalGroupId = new Types.ObjectId();
  const otherGroupId = new Types.ObjectId();

  // Belongs to both groups and is granted the "only me" page.
  const viewer = mock<IUserHasId>({
    _id: viewerId.toHexString(),
    admin: false,
  });
  // Belongs to no group and is granted no page.
  const adminViewer = mock<IUserHasId>({
    _id: adminId.toHexString(),
    admin: true,
  });

  const makePage = (
    name: string,
    grant: number,
    extra: Record<string, unknown> = {},
  ) => ({
    _id: new Types.ObjectId(),
    path: `${PATH_PREFIX}/${name}`,
    grant,
    grantedUsers: [],
    grantedGroups: [],
    status: 'published',
    ...extra,
  });

  const pages = {
    public: makePage('public', GRANT_PUBLIC),
    publicWipFalse: makePage('public-wip-false', GRANT_PUBLIC, { wip: false }),
    publicIsEmptyFalse: makePage('public-is-empty-false', GRANT_PUBLIC, {
      isEmpty: false,
    }),
    viewerOnlyMe: makePage('viewer-only-me', GRANT_OWNER, {
      grantedUsers: [viewerId],
    }),
    othersOnlyMe: makePage('others-only-me', GRANT_OWNER, {
      grantedUsers: [otherUserId],
    }),
    viewerGroup: makePage('viewer-group', GRANT_USER_GROUP, {
      grantedGroups: [{ type: 'UserGroup', item: viewerGroupId }],
    }),
    viewerExternalGroup: makePage('viewer-external-group', GRANT_USER_GROUP, {
      grantedGroups: [
        { type: 'ExternalUserGroup', item: viewerExternalGroupId },
      ],
    }),
    otherGroup: makePage('other-group', GRANT_USER_GROUP, {
      grantedGroups: [{ type: 'UserGroup', item: otherGroupId }],
    }),
    linkRestricted: makePage('link-restricted', GRANT_RESTRICTED),
    trashed: makePage('trashed', GRANT_PUBLIC, { status: 'deleted' }),
    wip: makePage('wip', GRANT_PUBLIC, { wip: true }),
    empty: makePage('empty', GRANT_PUBLIC, { isEmpty: true }),
    viewerOnlyMeTrashed: makePage('viewer-only-me-trashed', GRANT_OWNER, {
      grantedUsers: [viewerId],
      status: 'deleted',
    }),
    viewerOnlyMeWip: makePage('viewer-only-me-wip', GRANT_OWNER, {
      grantedUsers: [viewerId],
      wip: true,
    }),
  };
  const allPageIds = Object.values(pages).map((page) => page._id);

  const sortedPaths = (paths: string[]): string[] => [...paths].sort();

  const pathsOf = (...fixtures: { path: string }[]): string[] =>
    sortedPaths(fixtures.map((page) => page.path));

  // The filter is handed to findRaw exactly as returned; only the fixtures of
  // this file are looked at, because the database is shared with other files.
  const findPathsMatchedByFilter = async (
    user: IUserHasId,
  ): Promise<string[]> => {
    const filter = await buildListablePageFilter(user);
    const raw = await prisma.pages.findRaw({
      filter: filter as Prisma.InputJsonObject,
      options: { projection: { _id: 1, path: 1 } },
    });
    const matched = normalizeAggregateRaw(raw);
    assertIsArray(matched, 'pages.findRaw result');

    const ownIds = new Set(allPageIds.map((id) => id.toHexString()));
    return sortedPaths(
      matched.flatMap((doc) => {
        const id: unknown = Reflect.get(Object(doc), '_id');
        const path: unknown = Reflect.get(Object(doc), 'path');
        return typeof id === 'string' &&
          typeof path === 'string' &&
          ownIds.has(id)
          ? [path]
          : [];
      }),
    );
  };

  const findPathsShownByExistingList = async (
    user: IUserHasId,
  ): Promise<string[]> => {
    const Page = mongoose.model<PageDocument, PageModel>('Page');
    const builder = new PageQueryBuilder(
      Page.find({ _id: { $in: allPageIds } }),
    );
    await Page.addConditionToFilteringByViewerForList(builder, user, false);
    builder.addConditionToExcludeTrashed();
    builder.addConditionToExcludeWipPage();
    const docs = await builder.query.select('path').lean().exec();
    return sortedPaths(docs.map((doc) => doc.path));
  };

  beforeAll(async () => {
    // The existing list filter needs the Page model bound to a Crowi instance,
    // and both code paths need the config manager loaded.
    await getInstance();

    await pagesCollection().insertMany(Object.values(pages));
    await UserGroupRelation.create({
      relatedGroup: viewerGroupId,
      relatedUser: viewerId,
    });
    await ExternalUserGroupRelation.create({
      relatedGroup: viewerExternalGroupId,
      relatedUser: viewerId,
    });
  }, 60_000);

  afterAll(async () => {
    await pagesCollection().deleteMany({ _id: { $in: allPageIds } });
    await UserGroupRelation.deleteMany({ relatedUser: viewerId });
    await ExternalUserGroupRelation.deleteMany({ relatedUser: viewerId });
    await setListPolicy({
      hideRestrictedByOwner: false,
      hideRestrictedByGroup: false,
    });
  });

  describe.each(
    POLICY_COMBINATIONS,
  )('with hideRestrictedByOwner=$hideRestrictedByOwner and hideRestrictedByGroup=$hideRestrictedByGroup', (policy) => {
    beforeAll(async () => {
      await setListPolicy(policy);
    });

    it('matches, for a viewer with grants and groups, the listable pages only', async () => {
      const expected = [
        pages.public,
        pages.publicWipFalse,
        pages.publicIsEmptyFalse,
        pages.viewerOnlyMe,
        pages.viewerGroup,
        pages.viewerExternalGroup,
        ...(policy.hideRestrictedByOwner ? [] : [pages.othersOnlyMe]),
        ...(policy.hideRestrictedByGroup ? [] : [pages.otherGroup]),
      ];

      expect(await findPathsMatchedByFilter(viewer)).toEqual(
        pathsOf(...expected),
      );
    });

    it('gives an admin viewer no wider range than the list policy allows', async () => {
      const expected = [
        pages.public,
        pages.publicWipFalse,
        pages.publicIsEmptyFalse,
        ...(policy.hideRestrictedByOwner
          ? []
          : [pages.viewerOnlyMe, pages.othersOnlyMe]),
        ...(policy.hideRestrictedByGroup
          ? []
          : [pages.viewerGroup, pages.viewerExternalGroup, pages.otherGroup]),
      ];

      expect(await findPathsMatchedByFilter(adminViewer)).toEqual(
        pathsOf(...expected),
      );
    });

    it.each([
      { name: 'a viewer with grants and groups', user: viewer },
      { name: 'an admin viewer', user: adminViewer },
    ])('matches the same pages as the existing list minus trashed and WIP pages, for $name', async ({
      user,
    }) => {
      const shownByExistingList = await findPathsShownByExistingList(user);

      expect(shownByExistingList).not.toHaveLength(0);
      expect(await findPathsMatchedByFilter(user)).toEqual(shownByExistingList);
    });
  });
});

describe('aggregateUserActivities with the filter built by buildListablePageFilter', () => {
  const ACTIVITY_PATH_PREFIX = `${PATH_PREFIX}-activities`;
  // A sentinel ip value so cleanup deletes only this block's rows.
  const SEED_IP = '10.0.0.72';

  type PageFixture = { _id: Types.ObjectId; path: string };
  type ActivitySeed = ReturnType<typeof makeActivity>;

  const User = () => mongoose.model<IUserHasId>('User');

  const viewerId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const targetUserObjectId = new Types.ObjectId();
  const targetUserId = targetUserObjectId.toHexString();
  const otherUserId = new Types.ObjectId();
  const viewerGroupId = new Types.ObjectId();
  const otherGroupId = new Types.ObjectId();

  const actorOnUnlistedPagesOnlyId = new Types.ObjectId().toHexString();
  const actorOnMissingPageOnlyId = new Types.ObjectId().toHexString();
  const actorOnTrashedPageId = new Types.ObjectId().toHexString();
  const actorOnLargePagesId = new Types.ObjectId().toHexString();

  // User documents as the route receives them in req.user: _id is an ObjectId
  // instance, not a hex string.
  let viewer: IUserHasId;
  let adminViewer: IUserHasId;
  let targetUser: IUserHasId;

  const makePage = (
    name: string,
    grant: number,
    extra: Record<string, unknown> = {},
  ) => ({
    _id: new Types.ObjectId(),
    path: `${ACTIVITY_PATH_PREFIX}/${name}`,
    grant,
    grantedUsers: [],
    grantedGroups: [],
    status: 'published',
    ...extra,
  });

  const trashedState = (name: string) => ({
    path: `/trash${ACTIVITY_PATH_PREFIX}/${name}`,
    status: 'deleted',
    deleteUser: targetUserObjectId,
    deletedAt: new Date('2025-10-01T00:00:00Z'),
  });

  const SEEN_USERS_COUNT = 5000;
  const makeLargePage = (name: string, grant: number) =>
    makePage(name, grant, {
      seenUsers: Array.from(
        { length: SEEN_USERS_COUNT },
        () => new Types.ObjectId(),
      ),
    });

  const pages = {
    public: makePage('public', GRANT_PUBLIC),
    viewerOnlyMe: makePage('viewer-only-me', GRANT_OWNER, {
      grantedUsers: [viewerId],
    }),
    othersOnlyMe: makePage('others-only-me', GRANT_OWNER, {
      grantedUsers: [otherUserId],
    }),
    targetOnlyMe: makePage('target-only-me', GRANT_OWNER, {
      grantedUsers: [targetUserObjectId],
    }),
    viewerGroup: makePage('viewer-group', GRANT_USER_GROUP, {
      grantedGroups: [{ type: 'UserGroup', item: viewerGroupId }],
    }),
    otherGroup: makePage('other-group', GRANT_USER_GROUP, {
      grantedGroups: [{ type: 'UserGroup', item: otherGroupId }],
    }),
    linkRestricted: makePage('link-restricted', GRANT_RESTRICTED),
    trashed: makePage('trashed', GRANT_PUBLIC, trashedState('trashed')),
    wip: makePage('wip', GRANT_PUBLIC, { wip: true }),
    targetOnlyMeTrashed: makePage('target-only-me-trashed', GRANT_OWNER, {
      grantedUsers: [targetUserObjectId],
      ...trashedState('target-only-me-trashed'),
    }),
    targetOnlyMeWip: makePage('target-only-me-wip', GRANT_OWNER, {
      grantedUsers: [targetUserObjectId],
      wip: true,
    }),
    restorable: makePage(
      'restorable',
      GRANT_PUBLIC,
      trashedState('restorable'),
    ),
    largePublicA: makeLargePage('large-public-a', GRANT_PUBLIC),
    largePublicB: makeLargePage('large-public-b', GRANT_PUBLIC),
    largeLinkRestricted: makeLargePage(
      'large-link-restricted',
      GRANT_RESTRICTED,
    ),
  };
  const allPageIds = Object.values(pages).map((page) => page._id);
  const missingPageId = new Types.ObjectId().toHexString();

  const idOf = (page: PageFixture): string => page._id.toHexString();

  const makeActivity = (
    userId: string,
    target: string,
    action: SupportedActivityActionType,
    createdAt: Date,
  ) => ({
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action,
    createdAt,
    endpoint: '/test/user-activities-by-viewer',
    ip: SEED_IP,
    snapshot: { id: new Types.ObjectId().toHexString(), username: 'testuser' },
    userId,
    target,
    targetModel: 'Page',
  });

  const makeActivityOn = (
    userId: string,
    page: PageFixture,
    action: SupportedActivityActionType,
    createdAt: Date,
  ) => ({ page, seed: makeActivity(userId, idOf(page), action, createdAt) });

  const day = (n: number): Date => new Date(Date.UTC(2025, 8, n));

  // Every activity of the target user on a page that exists.
  const targetUserActivities = [
    makeActivityOn(
      targetUserId,
      pages.public,
      ActivityLogActions.ACTION_PAGE_CREATE,
      day(1),
    ),
    makeActivityOn(
      targetUserId,
      pages.public,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(2),
    ),
    makeActivityOn(
      targetUserId,
      pages.viewerOnlyMe,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(3),
    ),
    makeActivityOn(
      targetUserId,
      pages.othersOnlyMe,
      ActivityLogActions.ACTION_PAGE_LIKE,
      day(4),
    ),
    makeActivityOn(
      targetUserId,
      pages.targetOnlyMe,
      ActivityLogActions.ACTION_PAGE_CREATE,
      day(5),
    ),
    makeActivityOn(
      targetUserId,
      pages.viewerGroup,
      ActivityLogActions.ACTION_COMMENT_CREATE,
      day(6),
    ),
    makeActivityOn(
      targetUserId,
      pages.otherGroup,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(7),
    ),
    makeActivityOn(
      targetUserId,
      pages.linkRestricted,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(8),
    ),
    makeActivityOn(
      targetUserId,
      pages.trashed,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(9),
    ),
    makeActivityOn(
      targetUserId,
      pages.trashed,
      ActivityLogActions.ACTION_PAGE_DELETE,
      day(10),
    ),
    makeActivityOn(
      targetUserId,
      pages.wip,
      ActivityLogActions.ACTION_PAGE_CREATE,
      day(11),
    ),
    makeActivityOn(
      targetUserId,
      pages.targetOnlyMeTrashed,
      ActivityLogActions.ACTION_PAGE_DELETE,
      day(12),
    ),
    makeActivityOn(
      targetUserId,
      pages.targetOnlyMeWip,
      ActivityLogActions.ACTION_PAGE_CREATE,
      day(13),
    ),
  ];

  const activitiesOnRestorablePage = [
    makeActivityOn(
      actorOnTrashedPageId,
      pages.restorable,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(1),
    ),
    makeActivityOn(
      actorOnTrashedPageId,
      pages.restorable,
      ActivityLogActions.ACTION_PAGE_DELETE,
      day(2),
    ),
  ];

  const LARGE_PAGE_ACTIVITY_COUNT = 2400;
  const largePageCycle = [
    pages.largePublicA,
    pages.largeLinkRestricted,
    pages.largePublicB,
  ];
  const activitiesOnLargePages = Array.from(
    { length: LARGE_PAGE_ACTIVITY_COUNT },
    (_, i) =>
      makeActivityOn(
        actorOnLargePagesId,
        largePageCycle[i % largePageCycle.length],
        ActivityLogActions.ACTION_PAGE_UPDATE,
        new Date(Date.UTC(2025, 8, 1) + i * 1000),
      ),
  );

  const activitiesWithoutListedPage = [
    makeActivity(
      targetUserId,
      missingPageId,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(14),
    ),
    makeActivity(
      actorOnMissingPageOnlyId,
      missingPageId,
      ActivityLogActions.ACTION_PAGE_UPDATE,
      day(1),
    ),
    ...[
      pages.othersOnlyMe,
      pages.otherGroup,
      pages.linkRestricted,
      pages.trashed,
      pages.wip,
    ].map((page, i) =>
      makeActivity(
        actorOnUnlistedPagesOnlyId,
        idOf(page),
        ActivityLogActions.ACTION_PAGE_UPDATE,
        day(i + 1),
      ),
    ),
  ];

  // Newest first; the fixtures of one actor never share a createdAt.
  const rowsExpectedOn = (
    activities: { page: PageFixture; seed: ActivitySeed }[],
    listedPages: PageFixture[],
    pathOf: (page: PageFixture) => string = (page) => page.path,
  ): UserActivityRow[] =>
    activities
      .filter(({ page }) => listedPages.includes(page))
      .sort((a, b) => b.seed.createdAt.getTime() - a.seed.createdAt.getTime())
      .map(({ page, seed }) => ({
        _id: seed.id,
        action: seed.action,
        createdAt: seed.createdAt,
        target: { _id: idOf(page), path: pathOf(page) },
      }));

  const fetchActivities = async (
    user: IUserHasId,
    actorId: string,
    paging: { limit: number; offset: number } = { limit: 100, offset: 0 },
  ) =>
    aggregateUserActivities(prisma, {
      targetUserId: actorId,
      pageFilter: await buildListablePageFilter(user),
      ...paging,
    });

  let originalPolicy: ListPolicy;

  beforeAll(async () => {
    await getInstance();
    originalPolicy = {
      hideRestrictedByOwner: configManager.getConfig(
        'security:list-policy:hideRestrictedByOwner',
      ),
      hideRestrictedByGroup: configManager.getConfig(
        'security:list-policy:hideRestrictedByGroup',
      ),
    };

    const makeUser = (_id: Types.ObjectId, role: string, admin: boolean) => {
      const username = `user-activities-${role}-${_id.toHexString()}`;
      return {
        _id,
        name: username,
        username,
        email: `${username}@example.com`,
        admin,
      };
    };
    [viewer, adminViewer, targetUser] = await User().create([
      makeUser(viewerId, 'viewer', false),
      makeUser(adminId, 'admin', true),
      makeUser(targetUserObjectId, 'target', false),
    ]);

    await pagesCollection().insertMany(Object.values(pages));
    await UserGroupRelation.create({
      relatedGroup: viewerGroupId,
      relatedUser: viewerId,
    });
    await prisma.activities.createMany({
      data: [
        ...targetUserActivities.map(({ seed }) => seed),
        ...activitiesOnRestorablePage.map(({ seed }) => seed),
        ...activitiesOnLargePages.map(({ seed }) => seed),
        ...activitiesWithoutListedPage,
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: SEED_IP } });
    await pagesCollection().deleteMany({ _id: { $in: allPageIds } });
    await UserGroupRelation.deleteMany({ relatedUser: viewerId });
    await User().deleteMany({
      _id: { $in: [viewerId, adminId, targetUserObjectId] },
    });
    await setListPolicy(originalPolicy);
  });

  describe.each(
    POLICY_COMBINATIONS,
  )('with hideRestrictedByOwner=$hideRestrictedByOwner and hideRestrictedByGroup=$hideRestrictedByGroup', (policy) => {
    beforeAll(async () => {
      await setListPolicy(policy);
    });

    it('returns to a viewer with grants and groups only the activities on the pages the list shows them', async () => {
      const expected = rowsExpectedOn(targetUserActivities, [
        pages.public,
        pages.viewerOnlyMe,
        pages.viewerGroup,
        ...(policy.hideRestrictedByOwner
          ? []
          : [pages.othersOnlyMe, pages.targetOnlyMe]),
        ...(policy.hideRestrictedByGroup ? [] : [pages.otherGroup]),
      ]);

      const result = await fetchActivities(viewer, targetUserId);

      expect(result.docs).toStrictEqual(expected);
      expect(result.totalCount).toBe(expected.length);
    });

    it('gives an admin viewer no wider range than the list policy allows', async () => {
      const expected = rowsExpectedOn(targetUserActivities, [
        pages.public,
        ...(policy.hideRestrictedByOwner
          ? []
          : [pages.viewerOnlyMe, pages.othersOnlyMe, pages.targetOnlyMe]),
        ...(policy.hideRestrictedByGroup
          ? []
          : [pages.viewerGroup, pages.otherGroup]),
      ]);

      const result = await fetchActivities(adminViewer, targetUserId);

      expect(result.docs).toStrictEqual(expected);
      expect(result.totalCount).toBe(expected.length);
    });

    it('returns to the target user themself their own "only me" page, and nothing else the list would not show them', async () => {
      const expected = rowsExpectedOn(targetUserActivities, [
        pages.public,
        pages.targetOnlyMe,
        ...(policy.hideRestrictedByOwner
          ? []
          : [pages.viewerOnlyMe, pages.othersOnlyMe]),
        ...(policy.hideRestrictedByGroup
          ? []
          : [pages.viewerGroup, pages.otherGroup]),
      ]);

      const result = await fetchActivities(targetUser, targetUserId);

      expect(result.docs).toStrictEqual(expected);
      expect(result.totalCount).toBe(expected.length);
    });
  });

  describe('with both settings hiding restricted pages', () => {
    // None of the pages the first actor touched is listed for any viewer.
    beforeAll(async () => {
      await setListPolicy({
        hideRestrictedByOwner: true,
        hideRestrictedByGroup: true,
      });
    });

    it.each([
      { name: 'a viewer with grants and groups', user: () => viewer },
      { name: 'an admin viewer', user: () => adminViewer },
      { name: 'the target user themself', user: () => targetUser },
    ])('answers $name the same for an actor on unlisted pages only and an actor on a missing page only', async ({
      user,
    }) => {
      const onUnlistedPages = await fetchActivities(
        user(),
        actorOnUnlistedPagesOnlyId,
      );
      const onMissingPage = await fetchActivities(
        user(),
        actorOnMissingPageOnlyId,
      );

      expect(onUnlistedPages).toStrictEqual({ docs: [], totalCount: 0 });
      expect(onMissingPage).toStrictEqual(onUnlistedPages);
    });
  });

  it('returns the activities on a trashed page only after the page is restored', async () => {
    const restoredPath = `${ACTIVITY_PATH_PREFIX}/restorable`;
    await pagesCollection().updateOne(
      { _id: pages.restorable._id },
      { $set: trashedState('restorable') },
    );

    const whileTrashed = await fetchActivities(viewer, actorOnTrashedPageId);

    // The fields PageService's revert writes on the page.
    await pagesCollection().updateOne(
      { _id: pages.restorable._id },
      {
        $set: {
          path: restoredPath,
          status: 'published',
          lastUpdateUser: targetUserObjectId,
          deleteUser: null,
          deletedAt: null,
        },
      },
    );
    const afterRestore = await fetchActivities(viewer, actorOnTrashedPageId);

    expect(whileTrashed).toStrictEqual({ docs: [], totalCount: 0 });
    const expected = rowsExpectedOn(
      activitiesOnRestorablePage,
      [pages.restorable],
      () => restoredPath,
    );
    expect(afterRestore.docs).toStrictEqual(expected);
    expect(afterRestore.totalCount).toBe(expected.length);
  });

  it('returns a deep page of rows on pages whose documents are large', async () => {
    const expected = rowsExpectedOn(activitiesOnLargePages, [
      pages.largePublicA,
      pages.largePublicB,
    ]);
    const paging = { limit: 50, offset: 1500 };

    const result = await fetchActivities(viewer, actorOnLargePagesId, paging);

    expect(result.docs).toStrictEqual(
      expected.slice(paging.offset, paging.offset + paging.limit),
    );
    expect(result.docs).toHaveLength(paging.limit);
    expect(result.totalCount).toBe(expected.length);
  });
});
