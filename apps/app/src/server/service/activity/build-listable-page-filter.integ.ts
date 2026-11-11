import type { IUserHasId } from '@growi/core/dist/interfaces';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { Prisma } from '~/generated/prisma/client';
import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import {
  assertIsArray,
  normalizeAggregateRaw,
} from '~/server/util/prisma-raw-normalize';
import { prisma } from '~/utils/prisma';

import { buildListablePageFilter } from './build-listable-page-filter';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_PREFIX = `/build-listable-page-filter-integ-${WORKER_ID}`;

const GRANT_PUBLIC = 1;
const GRANT_RESTRICTED = 2;
const GRANT_OWNER = 4;
const GRANT_USER_GROUP = 5;

const POLICY_COMBINATIONS = [
  { hideRestrictedByOwner: false, hideRestrictedByGroup: false },
  { hideRestrictedByOwner: true, hideRestrictedByGroup: false },
  { hideRestrictedByOwner: false, hideRestrictedByGroup: true },
  { hideRestrictedByOwner: true, hideRestrictedByGroup: true },
];

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

  // Seeded through the driver so that an absent `wip` field stays absent.
  const pagesCollection = () => mongoose.connection.collection('pages');

  const sortedPaths = (paths: string[]): string[] => [...paths].sort();

  const pathsOf = (...fixtures: { path: string }[]): string[] =>
    sortedPaths(fixtures.map((page) => page.path));

  const setListPolicy = async (policy: {
    hideRestrictedByOwner: boolean;
    hideRestrictedByGroup: boolean;
  }): Promise<void> => {
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
