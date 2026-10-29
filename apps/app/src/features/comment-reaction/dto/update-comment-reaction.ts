import type { ICommentListItem } from '~/features/comment/interfaces';

/** isReacted: true = add, false = remove (explicit, never a toggle). */
export type UpdateCommentReactionRequestBody = {
  readonly emoji: string;
  readonly isReacted: boolean;
};

export type UpdateCommentReactionResponseBody = {
  readonly changed: boolean;
  /** The target comment as GET /_api/v3/comments/:id returns it, with its latest reactions. */
  readonly comment: ICommentListItem;
};
