import type { prisma } from '~/utils/prisma';

import type {
  FormatReactionUser,
  ReactionChip,
  ReactionUserRow,
} from '../../interfaces';
import { summarizeReactions } from './summarize-reactions';

type LoadReactionChipsDeps = {
  readonly prisma: Pick<typeof prisma, 'commentreactions' | 'users'>;
};

type LoadReactionChipsInput = {
  readonly commentIds: readonly string[];
  readonly viewerId: string | null;
  readonly formatUser: FormatReactionUser;
};

/**
 * Two separate reads instead of a relation `include`: a required relation
 * fails the whole query when a referenced user document is gone.
 */
export const loadReactionChips = async (
  { prisma: client }: LoadReactionChipsDeps,
  { commentIds, viewerId, formatUser }: LoadReactionChipsInput,
): Promise<ReadonlyMap<string, readonly ReactionChip[]>> => {
  const rows = await client.commentreactions.findMany({
    where: { commentId: { in: [...commentIds] } },
    orderBy: { createdAt: 'asc' },
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  // `_id` is a computed field: it is absent from an explicit `select` unless chosen,
  // and the formatter reads it.
  const users: ReactionUserRow[] = await client.users.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      _id: true,
      username: true,
      name: true,
      imageUrlCached: true,
    },
  });
  const usersById = new Map(users.map((u) => [u.id, u]));

  const summarized = summarizeReactions(rows, usersById, viewerId, formatUser);

  return new Map(commentIds.map((id) => [id, summarized.get(id) ?? []]));
};
