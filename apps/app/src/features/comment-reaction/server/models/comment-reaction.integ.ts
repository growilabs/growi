import { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

const { ObjectId } = Types;

describe('prisma.commentreactions', () => {
  const createdReactionIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    await prisma.commentreactions.deleteMany({
      where: { id: { in: createdReactionIds } },
    });
    await prisma.users.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  it('exposes _id equal to id and a readable __v on a created row', async () => {
    const reaction = await prisma.commentreactions.create({
      data: {
        commentId: new ObjectId().toString(),
        pageId: new ObjectId().toString(),
        userId: new ObjectId().toString(),
        emoji: 'unicode:+1',
        createdAt: new Date(),
      },
    });
    createdReactionIds.push(reaction.id);

    expect(reaction._id).toBeDefined();
    expect(reaction._id).toBe(reaction.id);
    expect(reaction.__v).toBe(0);

    const found = await prisma.commentreactions.findFirst({
      where: { id: reaction.id },
    });
    expect(found?._id).toBe(reaction.id);
    expect(found?.__v).toBe(0);
  });

  // Users that still own other relations (e.g. comments.creator) are out of
  // scope: only the reaction must not block the delete (see the deletion-path
  // extension section of design.md).
  it('lets a reacting user be deleted through Prisma without P2014', async () => {
    const userId = new ObjectId().toString();
    await prisma.users.create({
      data: {
        id: userId,
        username: `comment-reaction-integ-${userId}`,
        name: 'Comment Reaction User',
      },
    });
    createdUserIds.push(userId);

    const reactionIds = await Promise.all(
      ['unicode:+1', 'unicode:tada'].map(async (emoji) => {
        const reaction = await prisma.commentreactions.create({
          data: {
            commentId: new ObjectId().toString(),
            pageId: new ObjectId().toString(),
            userId,
            emoji,
            createdAt: new Date(),
          },
        });
        createdReactionIds.push(reaction.id);
        return reaction.id;
      }),
    );

    await expect(
      prisma.users.deleteMany({ where: { id: userId } }),
    ).resolves.toEqual({ count: 1 });

    await expect(
      prisma.commentreactions.count({ where: { id: { in: reactionIds } } }),
    ).resolves.toBe(reactionIds.length);
  });
});
