import type { ICommentListItem } from '~/features/comment/interfaces';

import type {
  InlineCommentReply,
  InlineCommentWithReplies,
} from '../../interfaces';

const toOrigin = (
  item: ICommentListItem,
): Omit<InlineCommentWithReplies, 'replies'> | null => {
  if (
    item.creatorId == null ||
    item.quote == null ||
    item.prefix == null ||
    item.suffix == null ||
    item.approxOffset == null ||
    item.anchorOriginRevisionId == null
  ) {
    return null;
  }

  return {
    id: item.id,
    pageId: item.pageId,
    creatorId: item.creatorId,
    creator: typeof item.creator === 'object' ? item.creator : null,
    comment: item.comment,
    anchorOriginRevisionId: item.anchorOriginRevisionId,
    anchor: {
      quote: item.quote,
      prefix: item.prefix,
      suffix: item.suffix,
      approxOffset: item.approxOffset,
    },
    resolvedById: item.resolvedById,
    resolvedAt: item.resolvedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

const toReply = (item: ICommentListItem): InlineCommentReply | null => {
  if (item.creatorId == null || item.replyToId == null) {
    return null;
  }

  return {
    id: item.id,
    pageId: item.pageId,
    creatorId: item.creatorId,
    creator: typeof item.creator === 'object' ? item.creator : null,
    comment: item.comment,
    replyToId: item.replyToId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
};

/**
 * Regroups the flat comment list into origin inline comments with their
 * replies, preserving the input order. Malformed origins and replies without
 * a surviving parent are dropped; ordinary comments are ignored.
 */
export const groupInlineComments = (
  items: readonly ICommentListItem[],
): InlineCommentWithReplies[] => {
  const inlineItems = items.filter((item) => item.isInline);

  const origins = inlineItems
    .filter((item) => item.replyToId == null)
    .map(toOrigin)
    .filter((origin) => origin != null);

  const repliesByOriginId = inlineItems
    .filter((item) => item.replyToId != null)
    .map(toReply)
    .filter((reply) => reply != null)
    .reduce((map, reply) => {
      const existing = map.get(reply.replyToId) ?? [];
      map.set(reply.replyToId, [...existing, reply]);
      return map;
    }, new Map<string, InlineCommentReply[]>());

  return origins.map((origin) => ({
    ...origin,
    replies: repliesByOriginId.get(origin.id) ?? [],
  }));
};
