import type { IUser } from '@growi/core';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import UserGroupRelation from '~/server/models/user-group-relation';

/**
 * The ids of every group — internal and external — that `user` belongs to, in the
 * `userGroups` shape the page grant filters take.
 *
 * Resolved once per request and handed to each viewer-filtered read: given `null`
 * for a signed-in user, every one of those reads looks the memberships up again.
 * A guest belongs to no group, so the answer for a guest is `null`.
 */
export const findUserGroupIdsForViewer = async (
  user: IUser | null,
): Promise<ObjectIdLike[] | null> => {
  if (user == null) {
    return null;
  }

  const [userGroupIds, externalUserGroupIds] = await Promise.all([
    UserGroupRelation.findAllUserGroupIdsRelatedToUser(user),
    ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user),
  ]);

  return [...userGroupIds, ...externalUserGroupIds];
};
