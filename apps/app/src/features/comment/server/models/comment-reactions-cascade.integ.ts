/**
 * Integration test for the reaction cleanup in `prisma.comments.removeWithReplies`
 * (covers the normal-comment and inline-comment-origin delete paths).
 *
 * Runs against a real MongoDB: Prisma's `relationMode = "prisma"` checks only
 * run on a real client, so a mock cannot reveal a P2014 from the delete order.
 */
import { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import './comment';

const { ObjectId } = Types;

describe('prisma.comments.removeWithReplies (reaction cleanup)', () => {
  const pageId = new ObjectId().toString();
  const revisionId = new ObjectId().toString();
  const commentIds: string[] = [];
  const reactionCommentIds: string[] = [];

  const createComment = async (
    overrides: Partial<{
      isInline: boolean;
      replyToId: string;
      quote: string;
    }> = {},
  ) => {
    const created = await prisma.comments.create({
      data: {
        pageId,
        creatorId: new ObjectId().toString(),
        revisionId,
        comment: 'comment for reaction cascade',
        commentPosition: -1,
        ...overrides,
      },
    });
    commentIds.push(created.id);
    return created;
  };

  const addReactions = async (commentId: string) => {
    reactionCommentIds.push(commentId);
    await prisma.commentreactions.createMany({
      data: [
        {
          commentId,
          pageId,
          userId: new ObjectId().toString(),
          emoji: 'unicode:+1',
        },
        {
          commentId,
          pageId,
          userId: new ObjectId().toString(),
          emoji: 'unicode:+1',
        },
        {
          commentId,
          pageId,
          userId: new ObjectId().toString(),
          emoji: 'unicode:tada',
        },
      ],
    });
  };

  const countReactions = (ids: string[]) =>
    prisma.commentreactions.count({ where: { commentId: { in: ids } } });

  afterAll(async () => {
    await prisma.commentreactions.deleteMany({
      where: { commentId: { in: reactionCommentIds } },
    });
    await prisma.comments.deleteMany({
      where: { id: { in: commentIds }, replyToId: { not: null } },
    });
    await prisma.comments.deleteMany({ where: { id: { in: commentIds } } });
  });

  it('deletes a normal comment, its replies and all of their reactions without an exception', async () => {
    const origin = await createComment();
    const reply = await createComment({ replyToId: origin.id });
    await addReactions(origin.id);
    await addReactions(reply.id);

    await expect(
      prisma.comments.removeWithReplies(origin.id),
    ).resolves.toBeUndefined();

    await expect(
      prisma.comments.count({ where: { id: { in: [origin.id, reply.id] } } }),
    ).resolves.toBe(0);
    await expect(countReactions([origin.id, reply.id])).resolves.toBe(0);
  });

  it('deletes an inline comment origin, its replies and all of their reactions without an exception', async () => {
    const origin = await createComment({ isInline: true, quote: 'quoted' });
    const reply = await createComment({
      isInline: true,
      replyToId: origin.id,
    });
    await addReactions(origin.id);
    await addReactions(reply.id);

    await expect(
      prisma.comments.removeWithReplies(origin.id),
    ).resolves.toBeUndefined();

    await expect(
      prisma.comments.count({ where: { id: { in: [origin.id, reply.id] } } }),
    ).resolves.toBe(0);
    await expect(countReactions([origin.id, reply.id])).resolves.toBe(0);
  });

  it('leaves reactions on other comments untouched', async () => {
    const target = await createComment();
    const bystander = await createComment();
    await addReactions(target.id);
    await addReactions(bystander.id);

    await prisma.comments.removeWithReplies(target.id);

    await expect(countReactions([bystander.id])).resolves.toBe(3);
  });

  it('rolls the whole transaction back when the comment document is missing, so the reactions remain', async () => {
    const missingCommentId = new ObjectId().toString();
    await addReactions(missingCommentId);

    await expect(
      prisma.comments.removeWithReplies(missingCommentId),
    ).rejects.toThrow();

    await expect(countReactions([missingCommentId])).resolves.toBe(3);
  });
});
