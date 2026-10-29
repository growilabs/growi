import mongoose, { Types } from 'mongoose';

import { replaceMongoDbName } from '^/test/setup/mongo/utils';

import { prisma } from '~/utils/prisma';

import type { ReactionKey } from '../../interfaces';
import { MAX_REACTION_KINDS_PER_COMMENT } from '../../interfaces';
import { addReaction, removeReaction } from './comment-reaction-service';

const { ObjectId } = Types;

const key = (value: string): ReactionKey => value as ReactionKey;

describe('comment-reaction-service', () => {
  const createdCommentIds: string[] = [];

  const newTarget = () => {
    const commentId = new ObjectId().toString();
    createdCommentIds.push(commentId);
    return { commentId, pageId: new ObjectId().toString() };
  };
  const newUserId = () => new ObjectId().toString();
  const countRows = (commentId: string, userId: string, emoji: string) =>
    prisma.commentreactions.count({ where: { commentId, userId, emoji } });

  // Without MONGO_URI the in-memory DB never runs migrations, so the unique index the
  // concurrent-add test relies on must be built here. The migration connects with
  // getMongoUri(), which must name the same database as the worker's connection.
  beforeAll(async () => {
    const mongoUri = process.env.MONGO_URI;
    if (mongoUri != null) {
      vi.stubEnv(
        'MONGO_URI',
        replaceMongoDbName(mongoUri, mongoose.connection.name),
      );
    }
    const migrate = await import(
      '~/migrations/20261016120000-add-indexes-to-commentreactions'
    );
    await migrate.up();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.commentreactions.deleteMany({
      where: { commentId: { in: createdCommentIds } },
    });
  });

  describe('addReaction / removeReaction', () => {
    it('adds a reaction, then reports already-reacted without adding a row', async () => {
      const target = newTarget();
      const userId = newUserId();
      const emoji = key('unicode:+1');

      await expect(
        addReaction({ prisma }, target, userId, emoji),
      ).resolves.toEqual({ kind: 'added' });
      await expect(
        addReaction({ prisma }, target, userId, emoji),
      ).resolves.toEqual({ kind: 'already-reacted' });

      await expect(countRows(target.commentId, userId, emoji)).resolves.toBe(1);
    });

    it('stores the target comment, page, user and emoji on the row', async () => {
      const target = newTarget();
      const userId = newUserId();
      await addReaction({ prisma }, target, userId, key('unicode:tada'));

      const row = await prisma.commentreactions.findFirst({
        where: { commentId: target.commentId },
      });
      expect(row).toMatchObject({
        commentId: target.commentId,
        pageId: target.pageId,
        userId,
        emoji: 'unicode:tada',
      });
    });

    it('removes a reaction, then reports not-reacted without error', async () => {
      const target = newTarget();
      const userId = newUserId();
      const emoji = key('unicode:+1');
      await addReaction({ prisma }, target, userId, emoji);

      await expect(
        removeReaction({ prisma }, target, userId, emoji),
      ).resolves.toEqual({ kind: 'removed' });
      await expect(
        removeReaction({ prisma }, target, userId, emoji),
      ).resolves.toEqual({ kind: 'not-reacted' });

      await expect(countRows(target.commentId, userId, emoji)).resolves.toBe(0);
    });

    it('removes a row stored under an alias key when that alias is sent', async () => {
      const target = newTarget();
      const userId = newUserId();
      await prisma.commentreactions.create({
        data: {
          commentId: target.commentId,
          pageId: target.pageId,
          userId,
          emoji: 'unicode:thumbsup',
          createdAt: new Date(),
        },
      });

      await expect(
        removeReaction({ prisma }, target, userId, 'unicode:thumbsup'),
      ).resolves.toEqual({ kind: 'removed' });

      await expect(
        countRows(target.commentId, userId, 'unicode:thumbsup'),
      ).resolves.toBe(0);
    });

    it('removes a row stored under the canonical key when an alias key is requested', async () => {
      const target = newTarget();
      const userId = newUserId();
      await addReaction({ prisma }, target, userId, key('unicode:+1'));

      await expect(
        removeReaction({ prisma }, target, userId, 'unicode:thumbsup'),
      ).resolves.toEqual({ kind: 'removed' });

      await expect(
        countRows(target.commentId, userId, 'unicode:+1'),
      ).resolves.toBe(0);
    });

    it('only removes the requesting user’s own row', async () => {
      const target = newTarget();
      const userA = newUserId();
      const userB = newUserId();
      const emoji = key('unicode:+1');
      await addReaction({ prisma }, target, userA, emoji);
      await addReaction({ prisma }, target, userB, emoji);

      await removeReaction({ prisma }, target, userA, emoji);

      await expect(countRows(target.commentId, userA, emoji)).resolves.toBe(0);
      await expect(countRows(target.commentId, userB, emoji)).resolves.toBe(1);
    });

    it('leaves exactly one row when the same reaction is added concurrently', async () => {
      const target = newTarget();
      const userId = newUserId();
      const emoji = key('unicode:heart');

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          addReaction({ prisma }, target, userId, emoji),
        ),
      );

      expect(results.filter((r) => r.kind === 'added')).toHaveLength(1);
      expect(results.filter((r) => r.kind === 'already-reacted')).toHaveLength(
        results.length - 1,
      );
      await expect(countRows(target.commentId, userId, emoji)).resolves.toBe(1);
    });

    it('lets the comment author react to their own comment (no authorship check)', async () => {
      // The service has no notion of the comment's author: any user id is accepted.
      const target = newTarget();
      await expect(
        addReaction({ prisma }, target, newUserId(), key('unicode:+1')),
      ).resolves.toEqual({ kind: 'added' });
    });
  });

  describe('kind limit', () => {
    const fillToLimit = async (target: {
      commentId: string;
      pageId: string;
    }) => {
      const emojis = Array.from(
        { length: MAX_REACTION_KINDS_PER_COMMENT },
        (_, i) => key(`unicode:kind-${i}`),
      );
      const filler = newUserId();
      await Promise.all(
        emojis.map((emoji) => addReaction({ prisma }, target, filler, emoji)),
      );
      return emojis;
    };

    it('defines the limit as 20 kinds per comment', () => {
      expect(MAX_REACTION_KINDS_PER_COMMENT).toBe(20);
    });

    it('rejects a new emoji kind once the limit is reached', async () => {
      const target = newTarget();
      await fillToLimit(target);
      const userId = newUserId();

      await expect(
        addReaction({ prisma }, target, userId, key('unicode:one-too-many')),
      ).resolves.toEqual({
        kind: 'kind-limit-exceeded',
        limit: MAX_REACTION_KINDS_PER_COMMENT,
      });
      await expect(
        countRows(target.commentId, userId, 'unicode:one-too-many'),
      ).resolves.toBe(0);
    });

    it('still lets another user add an existing kind, and anyone remove, at the limit', async () => {
      const target = newTarget();
      const emojis = await fillToLimit(target);
      const userId = newUserId();

      await expect(
        addReaction({ prisma }, target, userId, emojis[0]),
      ).resolves.toEqual({ kind: 'added' });
      await expect(
        removeReaction({ prisma }, target, userId, emojis[0]),
      ).resolves.toEqual({ kind: 'removed' });
    });

    it('accepts a new kind again after a kind is fully removed', async () => {
      const target = newTarget();
      const emojis = await fillToLimit(target);
      const filler = await prisma.commentreactions.findFirst({
        where: { commentId: target.commentId, emoji: emojis[0] },
      });
      await removeReaction({ prisma }, target, filler?.userId ?? '', emojis[0]);

      await expect(
        addReaction({ prisma }, target, newUserId(), key('unicode:fresh')),
      ).resolves.toEqual({ kind: 'added' });
    });

    it('counts kinds per comment, not across comments', async () => {
      await fillToLimit(newTarget());
      await expect(
        addReaction({ prisma }, newTarget(), newUserId(), key('unicode:+1')),
      ).resolves.toEqual({ kind: 'added' });
    });
  });
});
