import type { IGrantedGroup, IPage, IUser, PageGrant, Ref } from '@growi/core';
import { getIdForRef, PageGrant as PageGrantValues } from '@growi/core';
import mongoose from 'mongoose';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PageModel } from '~/server/models/page';
import UserGroupRelation from '~/server/models/user-group-relation';

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

const findGroupMemberIds = async (
  grantedGroups: readonly IGrantedGroup[],
): Promise<ReadonlySet<string>> => {
  const groupIds = grantedGroups.map((g) => getIdForRef(g.item));
  const [memberIds, externalMemberIds] = await Promise.all([
    UserGroupRelation.findAllUserIdsForUserGroups(groupIds),
    ExternalUserGroupRelation.findAllUserIdsForUserGroups(groupIds),
  ]);
  return new Set([...memberIds, ...externalMemberIds]);
};

// Mirrors generateGrantCondition (models/page.ts) with includeAnyoneWithTheLink:
// a link-only page is viewable by whoever has its id, which a notification
// recipient has anyway.
const findPageViewers = async (page: PageGrantFields): Promise<PageViewers> => {
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
        userIds: await findGroupMemberIds(page.grantedGroups),
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
  const grant = (await findStoredGrant(pageId)) ?? grantOfLastKnown(lastKnown);
  const viewers = grant == null ? NOBODY : await findPageViewers(grant);
  if (viewers.scope === 'anyone') {
    return [...userIds];
  }
  return userIds.filter((id) =>
    viewers.userIds.has(getIdForRef(id).toString()),
  );
};
