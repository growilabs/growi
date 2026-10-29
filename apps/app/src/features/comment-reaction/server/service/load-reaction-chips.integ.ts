import { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

import type { ReactionUserRow, ReactionUserSummary } from '../../interfaces';
import { loadReactionChips } from './load-reaction-chips';

const { ObjectId } = Types;

const formatUser = (user: ReactionUserRow): ReactionUserSummary => ({
  _id: user._id,
  username: user.username,
  name: user.name,
  imageUrlCached: user.imageUrlCached,
});

describe('loadReactionChips', () => {
  const pageId = new ObjectId().toString();
  const commentWithReactions = new ObjectId().toString();
  const commentWithout = new ObjectId().toString();
  const userId = new ObjectId().toString();
  const missingUserId = new ObjectId().toString();
  const reactionIds: string[] = [];

  beforeAll(async () => {
    await prisma.users.create({
      data: { id: userId, username: `loader-${userId}`, name: 'Loader User' },
    });
    const base = new Date('2026-01-01T00:00:00.000Z').getTime();
    const rows = [
      { userId, emoji: 'unicode:+1', offset: 1 },
      { userId: missingUserId, emoji: 'unicode:+1', offset: 2 },
    ];
    const created = await Promise.all(
      rows.map((r) =>
        prisma.commentreactions.create({
          data: {
            commentId: commentWithReactions,
            pageId,
            userId: r.userId,
            emoji: r.emoji,
            createdAt: new Date(base + r.offset * 60_000),
          },
        }),
      ),
    );
    reactionIds.push(...created.map((c) => c.id));
  });

  afterAll(async () => {
    await prisma.commentreactions.deleteMany({
      where: { id: { in: reactionIds } },
    });
    await prisma.users.deleteMany({ where: { id: userId } });
  });

  it('formats existing users with the 4 summary fields and _id equal to the user id', async () => {
    const result = await loadReactionChips(
      { prisma },
      { commentIds: [commentWithReactions], viewerId: null, formatUser },
    );

    const chip = result.get(commentWithReactions)?.[0];
    const user = chip?.users[0];
    expect(typeof user).toBe('object');
    expect(user).toEqual({
      _id: userId,
      username: `loader-${userId}`,
      name: 'Loader User',
      imageUrlCached: null,
    });
  });

  it('counts a reaction of a nonexistent user and represents it by id string', async () => {
    const result = await loadReactionChips(
      { prisma },
      { commentIds: [commentWithReactions], viewerId: userId, formatUser },
    );

    const chip = result.get(commentWithReactions)?.[0];
    expect(chip?.count).toBe(2);
    expect(chip?.users[1]).toBe(missingUserId);
    expect(chip?.reactedByMe).toBe(true);
  });

  it('returns an empty array for a comment without reactions', async () => {
    const result = await loadReactionChips(
      { prisma },
      {
        commentIds: [commentWithReactions, commentWithout],
        viewerId: null,
        formatUser,
      },
    );

    expect(result.get(commentWithout)).toEqual([]);
    expect(result.get(commentWithReactions)).toHaveLength(1);
  });
});
