/**
 * Integration test for the reaction cleanup in `InlineCommentService.deleteReply`.
 *
 * Runs against a real MongoDB so the transaction ordering and rollback are
 * exercised by the real Prisma client, not a mock.
 */
import { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import { InlineCommentService } from './inline-comment-service';

const { ObjectId } = Types;

describe('InlineCommentService.deleteReply (reaction cleanup)', () => {
  const pageId = new ObjectId().toString();
  const revisionId = new ObjectId().toString();
  const commentIds: string[] = [];
  const reactionCommentIds: string[] = [];

  let service: InlineCommentService;

  beforeAll(() => {
    service = new InlineCommentService({
      prisma,
      commentService: { prepareMentionNotifications: vi.fn() },
      updateCommentCount: vi.fn().mockResolvedValue(undefined),
    });
  });

  const createInlineComment = async (
    overrides: { replyToId?: string } = {},
  ) => {
    const creatorId = new ObjectId().toString();
    const created = await prisma.comments.create({
      data: {
        pageId,
        creatorId,
        revisionId,
        comment: 'inline comment for reply deletion',
        commentPosition: -1,
        isInline: true,
        quote: 'quoted',
        prefix: '',
        suffix: '',
        approxOffset: 0,
        ...overrides,
      },
    });
    commentIds.push(created.id);
    return { ...created, creatorId };
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
          emoji: 'unicode:tada',
        },
      ],
    });
  };

  const countReactions = (id: string) =>
    prisma.commentreactions.count({ where: { commentId: id } });

  afterAll(async () => {
    await prisma.commentreactions.deleteMany({
      where: { commentId: { in: reactionCommentIds } },
    });
    await prisma.comments.deleteMany({
      where: { id: { in: commentIds }, replyToId: { not: null } },
    });
    await prisma.comments.deleteMany({ where: { id: { in: commentIds } } });
  });

  it('deletes the reply and its reactions without an exception, leaving the origin and its reactions', async () => {
    const origin = await createInlineComment();
    const reply = await createInlineComment({ replyToId: origin.id });
    await addReactions(origin.id);
    await addReactions(reply.id);

    await expect(
      service.deleteReply(reply.id, reply.creatorId),
    ).resolves.toBeUndefined();

    await expect(
      prisma.comments.count({ where: { id: reply.id } }),
    ).resolves.toBe(0);
    await expect(countReactions(reply.id)).resolves.toBe(0);
    await expect(
      prisma.comments.count({ where: { id: origin.id } }),
    ).resolves.toBe(1);
    await expect(countReactions(origin.id)).resolves.toBe(2);
  });
});
