import type { users } from '~/generated/prisma/client';

import type { ReactionKey } from './reaction-key';

/** Same shape as comment's ICommentCreatorSummary, defined here so the reaction core imports nothing from comment. */
export type ReactionUserSummary = Pick<
  users,
  'username' | 'name' | 'imageUrlCached'
> & { _id: string };

/** A user summary, or the bare user id when the user document no longer exists. */
export type ReactionUser = ReactionUserSummary | string;

export type ReactionChip = {
  readonly emoji: ReactionKey;
  readonly count: number;
  readonly reactedByMe: boolean;
  readonly users: readonly ReactionUser[];
};

/** The fields selected from `users`, computed `_id` included. */
export type ReactionUserRow = Pick<
  users,
  'id' | 'username' | 'name' | 'imageUrlCached'
> & { _id: string };

export type FormatReactionUser = (user: ReactionUserRow) => ReactionUserSummary;
