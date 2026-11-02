import type { IUserHasId } from '@growi/core';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import UserGroupRelation from '~/server/models/user-group-relation';

import type { AttachmentSearchViewer } from './search-accessible-pages';

/**
 * Resolves the viewer the same way the page search route (`routes/search.ts`)
 * does: every internal and external group of a logged-in user, nothing for a
 * guest.
 */
export const resolveAttachmentSearchViewer = async (
  user: IUserHasId | null | undefined,
): Promise<AttachmentSearchViewer> => {
  if (user == null) {
    return { user: null, userGroups: null };
  }
  const [internal, external] = await Promise.all([
    UserGroupRelation.findAllUserGroupIdsRelatedToUser(user),
    ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(user),
  ]);
  return { user, userGroups: [...internal, ...external] };
};
