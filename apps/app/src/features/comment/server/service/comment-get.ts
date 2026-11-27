import type { PrismaClient } from '~/utils/prisma';

import type { ICommentListItem } from '../../interfaces';
import { toCommentListItem } from '../serializers/to-comment-list-item';
import { loadReactionChipsOrNull } from './load-reaction-chips-or-null';

type GetCommentListItemDeps = {
  readonly prisma: Pick<
    PrismaClient,
    'comments' | 'commentreactions' | 'users'
  >;
};

export interface GetCommentListItemInput {
  readonly commentId: string;
  readonly pageId: string;
  readonly viewerId: string | null;
}

/**
 * Reads one comment in the shape of a `GET /comments` item. Matching `pageId`
 * as well as `commentId` keeps a comment of another page unreachable.
 * Returns `null` when no such comment exists.
 */
export const getCommentListItem = async (
  { prisma }: GetCommentListItemDeps,
  { commentId, pageId, viewerId }: GetCommentListItemInput,
): Promise<ICommentListItem | null> => {
  const row = await prisma.comments.findFirst({
    where: { id: commentId, pageId },
    include: { creator: true },
  });
  if (row == null) {
    return null;
  }

  const chipsByCommentId = await loadReactionChipsOrNull(
    { prisma },
    { commentIds: [row.id], viewerId },
  );
  return toCommentListItem(
    row,
    chipsByCommentId == null ? null : (chipsByCommentId.get(row.id) ?? []),
  );
};
