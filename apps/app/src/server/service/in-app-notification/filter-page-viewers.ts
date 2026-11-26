import type { IGrantedGroup, IPage, IUser, PageGrant, Ref } from '@growi/core';
import { getIdForRef } from '@growi/core';
import mongoose from 'mongoose';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageModel } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';
import {
  canViewPageByGrant,
  type PageGrantIds,
} from '~/server/util/can-view-page-by-grant';
import { divideByType } from '~/server/util/granted-group';

type PageGrantFields = {
  // null for a page stored without a grant, which generateGrantCondition treats as public
  readonly grant: PageGrant | null;
  readonly grantedUsers: readonly Ref<IUser>[];
  readonly grantedGroups: readonly IGrantedGroup[];
};

/** The grant the activity event carried; activity events are not type-checked. */
export type LastKnownPageGrant = {
  readonly grant?: PageGrant | null;
  readonly grantedUsers?: readonly Ref<IUser>[];
  readonly grantedGroups?: readonly IGrantedGroup[];
};

const idOf = (ref: Ref<unknown>): string => getIdForRef(ref).toString();

const findStoredGrant = async (
  pageId: Ref<IPage> | null | undefined,
): Promise<PageGrantFields | null> => {
  if (pageId == null) {
    return null;
  }
  const Page = mongoose.model<IPage, PageModel>('Page');
  const page = await Page.findById(getIdForRef(pageId), {
    grant: 1,
    grantedUsers: 1,
    grantedGroups: 1,
  }).lean();
  if (page == null) {
    return null;
  }
  return {
    grant: page.grant ?? null,
    grantedUsers: page.grantedUsers ?? [],
    grantedGroups: page.grantedGroups ?? [],
  };
};

// A copy without a grant cannot be judged, so it reaches no one.
const grantOfLastKnown = (page: LastKnownPageGrant): PageGrantFields | null =>
  page.grant === undefined
    ? null
    : {
        grant: page.grant,
        grantedUsers: page.grantedUsers ?? [],
        grantedGroups: page.grantedGroups ?? [],
      };

const toGrantIds = (page: PageGrantFields): PageGrantIds => ({
  grant: page.grant,
  grantedUserIds: page.grantedUsers.map(idOf),
  grantedGroupIds: page.grantedGroups.map((g) => idOf(g.item)),
});

/** Each user's memberships among the granted groups only. */
const findGrantedGroupIdsByUser = async (
  grantedGroups: readonly IGrantedGroup[],
  userIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
  const { grantedUserGroups, grantedExternalUserGroups } = divideByType([
    ...grantedGroups,
  ]);
  const query = (groupIds: readonly ObjectIdLike[]) => ({
    relatedGroup: { $in: groupIds },
    relatedUser: { $in: userIds },
  });
  const projection = { relatedUser: 1, relatedGroup: 1 };
  const [relations, externalRelations] = await Promise.all([
    grantedUserGroups.length === 0
      ? []
      : UserGroupRelation.find(query(grantedUserGroups), projection).lean(),
    grantedExternalUserGroups.length === 0
      ? []
      : ExternalUserGroupRelation.find(
          query(grantedExternalUserGroups),
          projection,
        ).lean(),
  ]);
  const byUser = Map.groupBy([...relations, ...externalRelations], (relation) =>
    String(relation.relatedUser),
  );
  return new Map(
    [...byUser].map(([userId, userRelations]) => [
      userId,
      userRelations.map((relation) => String(relation.relatedGroup)),
    ]),
  );
};

/**
 * Judged by the page as stored; only a page that is no longer stored (deleted
 * completely) is judged by the grant the activity event carried.
 */
export const filterUsersWhoCanViewPage = async (
  pageId: Ref<IPage> | null | undefined,
  lastKnown: LastKnownPageGrant,
  userIds: readonly Ref<IUser>[],
): Promise<Ref<IUser>[]> => {
  if (userIds.length === 0) {
    return [];
  }
  const grant = (await findStoredGrant(pageId)) ?? grantOfLastKnown(lastKnown);
  if (grant == null) {
    return [];
  }
  const groupIdsByUser = await findGrantedGroupIdsByUser(
    grant.grantedGroups,
    userIds.map(idOf),
  );
  const grantIds = toGrantIds(grant);
  // Link-only pages count, as in the subscribe API's check. ProposalNotifier
  // leaves them out instead, since one of its notifications lists several
  // pages and would hand one page's link to a subscriber of another.
  return userIds.filter((id) =>
    canViewPageByGrant(
      grantIds,
      { userId: idOf(id), userGroupIds: groupIdsByUser.get(idOf(id)) ?? [] },
      { includeAnyoneWithTheLink: true },
    ),
  );
};
