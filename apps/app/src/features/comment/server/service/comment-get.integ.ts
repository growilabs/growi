import mongoose, { Types } from 'mongoose';

import { loadReactionChips } from '~/features/comment-reaction/server';
import { prisma } from '~/utils/prisma';

import {
  toCommentListItem,
  toCreatorSummary,
} from '../serializers/to-comment-list-item';
import { getCommentListItem } from './comment-get';
import { listComments } from './comment-list';

const { ObjectId } = Types;

describe('getCommentListItem', () => {
  const pageId = new ObjectId().toString();
  const otherPageId = new ObjectId().toString();
  const brokenPageId = new ObjectId().toString();
  const creatorId = new ObjectId().toString();
  const reactorId = new ObjectId().toString();
  const revisionId = new ObjectId().toString();

  let commentId: string;
  let brokenCommentId: string;

  beforeAll(async () => {
    await prisma.users.createMany({
      data: [
        {
          id: creatorId,
          username: `comment-get-integ-${creatorId}`,
          name: 'Comment Get Creator',
        },
        {
          id: reactorId,
          username: `comment-get-integ-${reactorId}`,
          name: 'Comment Get Reactor',
        },
      ],
    });
    await prisma.revisions.create({
      data: { id: revisionId, body: 'body', pageId },
    });
    commentId = (
      await prisma.comments.create({
        data: {
          pageId,
          revisionId,
          creatorId,
          comment: 'comment to read on its own',
          commentPosition: -1,
          isInline: false,
        },
      })
    ).id;
    brokenCommentId = (
      await prisma.comments.create({
        data: {
          pageId: brokenPageId,
          creatorId,
          comment: 'comment whose reactions cannot be read',
          commentPosition: -1,
          isInline: false,
        },
      })
    ).id;
    await prisma.commentreactions.createMany({
      data: [
        {
          commentId,
          pageId,
          userId: creatorId,
          emoji: 'unicode:+1',
          createdAt: new Date('2026-01-01T00:01:00.000Z'),
        },
        {
          commentId,
          pageId,
          userId: reactorId,
          emoji: 'unicode:+1',
          createdAt: new Date('2026-01-01T00:02:00.000Z'),
        },
        {
          commentId,
          pageId,
          userId: reactorId,
          emoji: 'unicode:tada',
          createdAt: new Date('2026-01-01T00:03:00.000Z'),
        },
      ],
    });
    // Written around Prisma: a row lacking the required `emoji` makes the reaction read throw.
    await mongoose.connection.collection('commentreactions').insertOne({
      comment: new ObjectId(brokenCommentId),
      page: new ObjectId(brokenPageId),
      user: new ObjectId(creatorId),
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    const pageIds = [pageId, otherPageId, brokenPageId];
    await mongoose.connection.collection('commentreactions').deleteMany({
      page: { $in: pageIds.map((id) => new ObjectId(id)) },
    });
    await prisma.comments.deleteMany({ where: { pageId: { in: pageIds } } });
    await prisma.revisions.deleteMany({ where: { pageId: { in: pageIds } } });
    await prisma.users.deleteMany({
      where: { id: { in: [creatorId, reactorId] } },
    });
  });

  const expectedListItemOf = async (
    viewerId: string | null,
  ): Promise<unknown> => {
    const result = await listComments({ prisma }, { pageId });
    if (result.kind !== 'ok') {
      throw new Error(`expected kind "ok", got "${result.kind}"`);
    }
    const row = result.comments.find((r) => r.id === commentId);
    if (row == null) {
      throw new Error('fixture comment is missing from the list');
    }
    const chips = await loadReactionChips(
      { prisma },
      { commentIds: [commentId], viewerId, formatUser: toCreatorSummary },
    );
    return toCommentListItem(row, chips.get(commentId) ?? []);
  };

  it.each([
    ['a viewer who reacted', () => reactorId],
    ['a viewer who did not react', () => new ObjectId().toString()],
    ['a guest', () => null],
  ])('returns the same item as the list for %s', async (_label, viewer) => {
    const viewerId = viewer();
    const item = await getCommentListItem(
      { prisma },
      { commentId, pageId, viewerId },
    );

    // Compared as serialized, which is what the API emits.
    expect(JSON.parse(JSON.stringify(item))).toEqual(
      JSON.parse(JSON.stringify(await expectedListItemOf(viewerId))),
    );
    expect(item?.reactions?.map((c) => [c.emoji, c.count])).toEqual([
      ['unicode:+1', 2],
      ['unicode:tada', 1],
    ]);
  });

  it('returns the creator as the display summary only', async () => {
    const item = await getCommentListItem(
      { prisma },
      { commentId, pageId, viewerId: null },
    );

    expect(item?.creator).toStrictEqual({
      _id: creatorId,
      username: `comment-get-integ-${creatorId}`,
      name: 'Comment Get Creator',
      imageUrlCached: null,
    });
    expect(item?.creator).not.toHaveProperty('password');
    expect(item?.creator).not.toHaveProperty('apiToken');
    expect(item?.creator).not.toHaveProperty('email');
  });

  it('flags reactedByMe only for the viewer who reacted', async () => {
    const asReactor = await getCommentListItem(
      { prisma },
      { commentId, pageId, viewerId: reactorId },
    );
    const asGuest = await getCommentListItem(
      { prisma },
      { commentId, pageId, viewerId: null },
    );

    expect(asReactor?.reactions?.map((c) => c.reactedByMe)).toEqual([
      true,
      true,
    ]);
    expect(asGuest?.reactions?.map((c) => c.reactedByMe)).toEqual([
      false,
      false,
    ]);
  });

  it('returns null when the comment belongs to a different page', async () => {
    const item = await getCommentListItem(
      { prisma },
      { commentId, pageId: otherPageId, viewerId: null },
    );

    expect(item).toBeNull();
  });

  it('returns null when the comment does not exist', async () => {
    const item = await getCommentListItem(
      { prisma },
      { commentId: new ObjectId().toString(), pageId, viewerId: null },
    );

    expect(item).toBeNull();
  });

  it('returns the comment with reactions null when the reactions cannot be loaded', async () => {
    const item = await getCommentListItem(
      { prisma },
      { commentId: brokenCommentId, pageId: brokenPageId, viewerId: null },
    );

    expect(item).not.toBeNull();
    expect(item?.id).toBe(brokenCommentId);
    expect(item?.comment).toBe('comment whose reactions cannot be read');
    expect(item?.reactions).toBeNull();
  });
});
