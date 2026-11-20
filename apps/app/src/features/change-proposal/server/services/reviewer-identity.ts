import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import UserGroupRelation from '~/server/models/user-group-relation';

import type { ViewerIdentity } from '../domain';

const toIdSet = (ids: readonly unknown[]): ReadonlySet<string> =>
  new Set(ids.map(String));

/**
 * Reads the user's groups from the same relations the page viewing check reads,
 * so being a reviewer through a group and viewing that group's pages agree.
 * Read once per request and passed on (Req 19.9: membership at that time).
 */
export const loadViewerIdentity = async (
  userId: string,
): Promise<ViewerIdentity> => {
  const user = { _id: userId };
  const [userGroupIds, externalUserGroupIds] = await Promise.all([
    UserGroupRelation.findAllUserGroupIdsRelatedToUser(user),
    ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user),
  ]);
  return {
    userId,
    userGroupIds: toIdSet(userGroupIds),
    externalUserGroupIds: toIdSet(externalUserGroupIds),
  };
};
