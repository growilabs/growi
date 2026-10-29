import type { commentreactions } from '~/generated/prisma/client';

import type {
  FormatReactionUser,
  ReactionChip,
  ReactionKey,
  ReactionUser,
  ReactionUserRow,
} from '../../interfaces';

type ChipDraft = {
  readonly emoji: ReactionKey;
  readonly rows: readonly commentreactions[];
};

const byCreatedAt = (a: commentreactions, b: commentreactions): number =>
  a.createdAt.getTime() - b.createdAt.getTime();

const groupBy = <T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): ReadonlyMap<string, readonly T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group != null) {
      // Mutates only the array built in this function (never visible to callers); copying per item would be quadratic.
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
};

const toChip = (
  draft: ChipDraft,
  usersById: ReadonlyMap<string, ReactionUserRow>,
  viewerId: string | null,
  formatUser: FormatReactionUser,
): ReactionChip => ({
  emoji: draft.emoji,
  count: draft.rows.length,
  reactedByMe:
    viewerId != null && draft.rows.some((r) => r.userId === viewerId),
  users: draft.rows.map((r): ReactionUser => {
    const user = usersById.get(r.userId);
    return user != null ? formatUser(user) : r.userId;
  }),
});

/**
 * Aggregates plain `commentreactions` rows into per-comment chips.
 * A missing user document does not drop the row: it still counts and is represented by its id string.
 */
export const summarizeReactions = (
  rows: readonly commentreactions[],
  usersById: ReadonlyMap<string, ReactionUserRow>,
  viewerId: string | null,
  formatUser: FormatReactionUser,
): ReadonlyMap<string, readonly ReactionChip[]> => {
  const chipsByComment = new Map<string, readonly ReactionChip[]>();

  for (const [commentId, commentRows] of groupBy(rows, (r) => r.commentId)) {
    const drafts: ChipDraft[] = [...groupBy(commentRows, (r) => r.emoji)]
      .map(([emoji, emojiRows]) => ({
        emoji: emoji as ReactionKey,
        rows: [...emojiRows].sort(byCreatedAt),
      }))
      // rows are sorted, so rows[0] is the earliest remaining row of the chip
      .sort((a, b) => byCreatedAt(a.rows[0], b.rows[0]));

    chipsByComment.set(
      commentId,
      drafts.map((d) => toChip(d, usersById, viewerId, formatUser)),
    );
  }

  return chipsByComment;
};
