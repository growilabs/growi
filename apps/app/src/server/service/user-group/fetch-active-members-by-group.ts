import { GroupType } from '@growi/core';
import mongoose, { type Types } from 'mongoose';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PopulatedGrantedGroup } from '~/interfaces/page-grant';
import type {
  IUserGroupMember,
  RelatedGroupsMembers,
} from '~/interfaces/user-group-member';
import { UserStatus } from '~/server/models/user/conts';
import UserGroupRelation from '~/server/models/user-group-relation';

/**
 * Constraints:
 * - Only queries relations for the provided groups (no ancestor/descendant expansion).
 * - Returns only name and username fields (STATUS_ACTIVE users only).
 * - Groups with no active members return an empty array.
 */
export const fetchActiveMembersByGroup = async (
  groups: PopulatedGrantedGroup[],
): Promise<RelatedGroupsMembers> => {
  if (groups.length === 0) {
    return {};
  }

  const internalGroupIds = groups
    .filter((g) => g.type === GroupType.userGroup)
    .map((g) => g.item._id);
  const externalGroupIds = groups
    .filter((g) => g.type === GroupType.externalUserGroup)
    .map((g) => g.item._id);

  const initialResult: RelatedGroupsMembers = Object.fromEntries(
    groups.map((g): [string, IUserGroupMember[]] => [
      g.item._id.toString(),
      [],
    ]),
  );

  const [internalRelations, externalRelations] = await Promise.all([
    internalGroupIds.length > 0
      ? UserGroupRelation.find({ relatedGroup: { $in: internalGroupIds } })
          .select('relatedGroup relatedUser')
          .exec()
      : Promise.resolve([]),
    externalGroupIds.length > 0
      ? ExternalUserGroupRelation.find({
          relatedGroup: { $in: externalGroupIds },
        })
          .select('relatedGroup relatedUser')
          .exec()
      : Promise.resolve([]),
  ]);

  const userIdToGroupIds: Record<string, string[]> = {};
  for (const rel of [...internalRelations, ...externalRelations]) {
    const userId = rel.relatedUser.toString();
    const groupId = rel.relatedGroup.toString();
    userIdToGroupIds[userId] = [...(userIdToGroupIds[userId] ?? []), groupId];
  }

  if (Object.keys(userIdToGroupIds).length === 0) {
    return initialResult;
  }

  type ActiveUserFields = {
    _id: Types.ObjectId;
    name: string;
    username: string;
  };
  const User = mongoose.model<ActiveUserFields>('User');
  const activeUsers = await User.find({
    _id: { $in: Object.keys(userIdToGroupIds) },
    status: UserStatus.STATUS_ACTIVE,
  })
    .select('name username')
    .lean()
    .exec();

  const result = { ...initialResult };
  for (const user of activeUsers) {
    const userId = user._id.toString();
    const groupIds = userIdToGroupIds[userId];
    if (groupIds == null) continue;
    const member: IUserGroupMember = {
      name: user.name,
      username: user.username,
    };
    for (const groupId of groupIds) {
      if (groupId in result) {
        result[groupId] = [...result[groupId], member];
      }
    }
  }
  return result;
};
