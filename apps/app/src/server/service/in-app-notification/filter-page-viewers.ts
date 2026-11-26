import type { IGrantedGroup, IPage, IUser, PageGrant, Ref } from '@growi/core';
import { getIdForRef, PageGrant as PageGrantValues } from '@growi/core';
import mongoose from 'mongoose';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageModel } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';
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

type PageViewers =
  | { readonly scope: 'anyone' }
  | { readonly scope: 'only'; readonly userIds: ReadonlySet<string> };

const NOBODY: PageViewers = { scope: 'only', userIds: new Set() };

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

const findMembersAmong = async (
  grantedGroups: readonly IGrantedGroup[],
  userIds: readonly string[],
): Promise<ReadonlySet<string>> => {
  const { grantedUserGroups, grantedExternalUserGroups } = divideByType([
    ...grantedGroups,
  ]);
  const query = (groupIds: readonly ObjectIdLike[]) => ({
    relatedGroup: { $in: groupIds },
    relatedUser: { $in: userIds },
  });
  const [members, externalMembers] = await Promise.all([
    grantedUserGroups.length === 0
      ? []
      : UserGroupRelation.distinct('relatedUser', query(grantedUserGroups)),
    grantedExternalUserGroups.length === 0
      ? []
      : ExternalUserGroupRelation.distinct(
          'relatedUser',
          query(grantedExternalUserGroups),
        ),
  ]);
  return new Set([...members, ...externalMembers].map(String));
};

// Mirrors generateGrantCondition (models/page.ts) with includeAnyoneWithTheLink:
// a link-only page is viewable by whoever has its id, which a notification
// recipient has anyway.
const findViewersAmong = async (
  page: PageGrantFields,
  userIds: readonly string[],
): Promise<PageViewers> => {
  switch (page.grant) {
    case null:
    case PageGrantValues.GRANT_PUBLIC:
    case PageGrantValues.GRANT_RESTRICTED:
      return { scope: 'anyone' };
    case PageGrantValues.GRANT_SPECIFIED:
    case PageGrantValues.GRANT_OWNER:
      return {
        scope: 'only',
        userIds: new Set(
          page.grantedUsers.map((u) => getIdForRef(u).toString()),
        ),
      };
    case PageGrantValues.GRANT_USER_GROUP:
      return {
        scope: 'only',
        userIds: await findMembersAmong(page.grantedGroups, userIds),
      };
    default:
      return NOBODY;
  }
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
  const viewers =
    grant == null
      ? NOBODY
      : await findViewersAmong(
          grant,
          userIds.map((id) => getIdForRef(id).toString()),
        );
  if (viewers.scope === 'anyone') {
    return [...userIds];
  }
  return userIds.filter((id) =>
    viewers.userIds.has(getIdForRef(id).toString()),
  );
};
