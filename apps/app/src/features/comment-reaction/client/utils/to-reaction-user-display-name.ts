import type { ReactionUser } from '../../interfaces';

/** `name`, else `username`; a bare ID string (a deleted user) is shown as is. */
export const toReactionUserDisplayName = (user: ReactionUser): string => {
  if (typeof user === 'string') {
    return user;
  }
  return user.name != null && user.name !== '' ? user.name : user.username;
};
