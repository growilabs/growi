import type { ICommentListItem } from '~/features/comment/interfaces';

import type { ReactionChip } from '../../interfaces';

// Keyed by the list array itself: every CommentReactionBar reads the same SWR
// data, so the index is built once per list instead of once per bar.
// Relies on the list being replaced with a new array on every change, never mutated in place.
const indexCache = new WeakMap<
  readonly ICommentListItem[],
  ReadonlyMap<string, readonly ReactionChip[] | null>
>();

const indexOf = (
  comments: readonly ICommentListItem[],
): ReadonlyMap<string, readonly ReactionChip[] | null> => {
  const cached = indexCache.get(comments);
  if (cached != null) {
    return cached;
  }
  const index = new Map(
    comments.map((comment) => [comment.id, comment.reactions ?? null]),
  );
  indexCache.set(comments, index);
  return index;
};

/** null when the comment is absent or its reactions could not be loaded. */
export const findReactionsByCommentId = (
  comments: readonly ICommentListItem[],
  commentId: string,
): readonly ReactionChip[] | null => indexOf(comments).get(commentId) ?? null;
