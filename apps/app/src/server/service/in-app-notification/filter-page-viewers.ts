import type { IGrantedGroup, IUser, PageGrant, Ref } from '@growi/core';
import { getIdForRef, PageGrant as PageGrantValues } from '@growi/core';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import UserGroupRelation from '~/server/models/user-group-relation';

export type PageGrantFields = {
  // undefined means the caller did not pass the grant, which is not the same as
  // a stored null (treated as public, like generateGrantCondition does).
  readonly grant?: PageGrant | null;
  readonly grantedUsers?: readonly Ref<IUser>[];
  readonly grantedGroups?: readonly IGrantedGroup[];
};

type PageViewers =
  | { readonly scope: 'anyone' }
  | { readonly scope: 'only'; readonly userIds: ReadonlySet<string> };

const NOBODY: PageViewers = { scope: 'only', userIds: new Set() };

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
          (page.grantedUsers ?? []).map((u) => getIdForRef(u).toString()),
        ),
      };
    case PageGrantValues.GRANT_USER_GROUP:
      return {
        scope: 'only',
        userIds: await findGroupMemberIds(page.grantedGroups ?? []),
      };
    default:
      return NOBODY;
  }
};

/**
 * Judged from the given page object rather than a DB lookup, so a page that
 * has already been deleted completely is still evaluated by its last grant.
 */
export const filterUsersWhoCanViewPage = async (
  page: PageGrantFields,
  userIds: readonly Ref<IUser>[],
): Promise<Ref<IUser>[]> => {
  const viewers = await findPageViewers(page);
  if (viewers.scope === 'anyone') {
    return [...userIds];
  }
  return userIds.filter((id) =>
    viewers.userIds.has(getIdForRef(id).toString()),
  );
};
