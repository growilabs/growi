import { Prisma } from '~/generated/prisma/client';
import type { prisma } from '~/utils/prisma';

import type { ReactionKey } from '../../interfaces';
import { MAX_REACTION_KINDS_PER_COMMENT } from '../../interfaces';
import { normalizeReactionKey } from '../../utils';

type CommentReactionServiceDeps = {
  readonly prisma: Pick<typeof prisma, 'commentreactions'>;
};

export type ReactionTarget = {
  readonly commentId: string;
  readonly pageId: string;
};

export type AddReactionResult =
  | { readonly kind: 'added' }
  | { readonly kind: 'already-reacted' }
  | { readonly kind: 'kind-limit-exceeded'; readonly limit: number };

export type RemoveReactionResult =
  | { readonly kind: 'removed' }
  | { readonly kind: 'not-reacted' };

const isUniqueConstraintViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * The caller has already authenticated the user, checked page visibility and
 * normalized `emoji`. Whether the user wrote the comment is deliberately not checked.
 */
export const addReaction = async (
  { prisma: client }: CommentReactionServiceDeps,
  { commentId, pageId }: ReactionTarget,
  userId: string,
  emoji: ReactionKey,
): Promise<AddReactionResult> => {
  const existing = await client.commentreactions.findFirst({
    where: { commentId, userId, emoji },
    select: { id: true },
  });
  if (existing != null) {
    return { kind: 'already-reacted' };
  }

  const kinds = await client.commentreactions.findMany({
    where: { commentId },
    distinct: ['emoji'],
    select: { emoji: true },
  });
  const kindIsNew = !kinds.some((k) => k.emoji === emoji);
  if (kindIsNew && kinds.length >= MAX_REACTION_KINDS_PER_COMMENT) {
    return {
      kind: 'kind-limit-exceeded',
      limit: MAX_REACTION_KINDS_PER_COMMENT,
    };
  }

  try {
    await client.commentreactions.create({
      data: { commentId, pageId, userId, emoji, createdAt: new Date() },
    });
  } catch (err) {
    // A concurrent identical request won the race on the unique index.
    if (isUniqueConstraintViolation(err)) {
      return { kind: 'already-reacted' };
    }
    throw err;
  }
  return { kind: 'added' };
};

/** `emoji` is the key as sent; the canonical form is removed too (see research.md, "解除は送られたキーと正規化したキーの両方で削除し…"). */
export const removeReaction = async (
  { prisma: client }: CommentReactionServiceDeps,
  { commentId }: ReactionTarget,
  userId: string,
  emoji: string,
): Promise<RemoveReactionResult> => {
  const normalized = normalizeReactionKey(emoji);
  const emojis = normalized.ok ? [emoji, normalized.value] : [emoji];
  const { count } = await client.commentreactions.deleteMany({
    where: { commentId, userId, emoji: { in: [...new Set(emojis)] } },
  });
  return count > 0 ? { kind: 'removed' } : { kind: 'not-reacted' };
};
