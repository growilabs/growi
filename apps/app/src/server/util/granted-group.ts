import { GroupType, type IGrantedGroup } from '@growi/core';

import type { ObjectIdLike } from '../interfaces/mongoose-utils';

export const divideByType = (
  grantedGroups: IGrantedGroup[] | null,
): {
  grantedUserGroups: ObjectIdLike[];
  grantedExternalUserGroups: ObjectIdLike[];
} => {
  const grantedUserGroups: ObjectIdLike[] = [];
  const grantedExternalUserGroups: ObjectIdLike[] = [];

  if (grantedGroups == null) {
    return { grantedUserGroups, grantedExternalUserGroups };
  }

  grantedGroups.forEach((group) => {
    const id = typeof group.item === 'string' ? group.item : group.item._id;
    if (group.type === GroupType.userGroup) {
      grantedUserGroups.push(id);
    } else {
      grantedExternalUserGroups.push(id);
    }
  });

  return { grantedUserGroups, grantedExternalUserGroups };
};
