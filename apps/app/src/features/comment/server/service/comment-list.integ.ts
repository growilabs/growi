import { Types } from 'mongoose';

import type { Prisma } from '~/generated/prisma/client';
import { prisma } from '~/utils/prisma';

import { type ListCommentsResult, listComments } from './comment-list';

const { ObjectId } = Types;

const at = (iso: string): Date => new Date(iso);

const commentsOf = (result: ListCommentsResult): readonly string[] => {
  if (result.kind !== 'ok') {
    throw new Error(`expected kind "ok", got "${result.kind}"`);
  }
  return result.comments.map((row) => row.comment);
};

describe('listComments', () => {
  const pageId = new ObjectId().toString();
  const otherPageId = new ObjectId().toString();
  const creatorId = new ObjectId().toString();

  // Revisions of the page: r1 < r2 < r3 (latest).
  const r1 = new ObjectId().toString();
  const r2 = new ObjectId().toString();
  const r3 = new ObjectId().toString();
  const otherPageRevision = new ObjectId().toString();

  const r2CreatedAt = at('2026-01-03T00:00:00.000Z');

  const commentIds: string[] = [];

  const createComment = async (
    data: Omit<
      Prisma.commentsUncheckedCreateInput,
      'pageId' | 'revisionId' | 'commentPosition'
    > & { createdAt: Date },
    targetPageId: string = pageId,
  ): Promise<string> => {
    const row = await prisma.comments.create({
      data: {
        pageId: targetPageId,
        revisionId: targetPageId === pageId ? r1 : otherPageRevision,
        commentPosition: -1,
        ...data,
      },
    });
    commentIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    await prisma.users.create({
      data: {
        id: creatorId,
        username: `list-comments-integ-${creatorId}`,
        name: 'List Comments Creator',
      },
    });
    await prisma.pages.create({
      data: { id: pageId, path: `/list-comments-integ-${pageId}`, v: 0 },
    });
    await prisma.pages.create({
      data: {
        id: otherPageId,
        path: `/list-comments-integ-${otherPageId}`,
        v: 0,
      },
    });
    await prisma.revisions.createMany({
      data: [
        {
          id: r1,
          body: 'r1',
          pageId,
          createdAt: at('2026-01-01T00:00:00.000Z'),
        },
        { id: r2, body: 'r2', pageId, createdAt: r2CreatedAt },
        {
          id: r3,
          body: 'r3',
          pageId,
          createdAt: at('2026-01-05T00:00:00.000Z'),
        },
        {
          id: otherPageRevision,
          body: 'other',
          pageId: otherPageId,
          createdAt: at('2026-01-02T00:00:00.000Z'),
        },
      ],
    });

    // Before r2
    const normalBeforeR2 = await createComment({
      comment: 'normal before r2',
      creatorId,
      createdAt: at('2026-01-02T00:00:00.000Z'),
    });
    await createComment({
      comment: 'normal reply before r2',
      creatorId,
      replyToId: normalBeforeR2,
      createdAt: at('2026-01-02T06:00:00.000Z'),
    });
    const inlineBeforeR2 = await createComment({
      comment: 'inline before r2',
      creatorId,
      isInline: true,
      quote: 'quoted',
      prefix: 'pre',
      suffix: 'suf',
      approxOffset: 10,
      anchorOriginRevisionId: r1,
      createdAt: at('2026-01-02T12:00:00.000Z'),
    });
    // Exactly at r2's createdAt: no longer "before the next revision" of r1.
    await createComment({
      comment: 'normal at r2',
      creatorId,
      createdAt: r2CreatedAt,
    });
    // Reply posted after r2 to a parent posted before r2.
    await createComment({
      comment: 'inline reply between r2 and r3',
      creatorId,
      isInline: true,
      replyToId: inlineBeforeR2,
      createdAt: at('2026-01-04T00:00:00.000Z'),
    });
    await createComment({
      comment: 'resolved inline after r3',
      creatorId,
      isInline: true,
      quote: 'quoted later',
      prefix: 'pre',
      suffix: 'suf',
      approxOffset: 20,
      anchorOriginRevisionId: r3,
      resolvedById: creatorId,
      resolvedAt: at('2026-01-07T00:00:00.000Z'),
      createdAt: at('2026-01-06T00:00:00.000Z'),
    });

    await createComment(
      {
        comment: 'comment on another page',
        creatorId,
        createdAt: at('2026-01-02T00:00:00.000Z'),
      },
      otherPageId,
    );
  });

  afterAll(async () => {
    // Replies first: the replyTo relation forbids deleting a referenced parent.
    await prisma.comments.deleteMany({
      where: { id: { in: commentIds }, replyToId: { not: null } },
    });
    await prisma.comments.deleteMany({ where: { id: { in: commentIds } } });
    await prisma.revisions.deleteMany({
      where: { id: { in: [r1, r2, r3, otherPageRevision] } },
    });
    await prisma.pages.deleteMany({
      where: { id: { in: [pageId, otherPageId] } },
    });
    await prisma.users.deleteMany({ where: { id: creatorId } });
  });

  describe('without a revision', () => {
    it('returns normal, inline, reply and resolved comments of the page, newest first', async () => {
      const result = await listComments({ prisma }, { pageId });

      expect(commentsOf(result)).toEqual([
        'resolved inline after r3',
        'inline reply between r2 and r3',
        'normal at r2',
        'inline before r2',
        'normal reply before r2',
        'normal before r2',
      ]);
    });

    it('returns each row with its creator and inline fields loaded', async () => {
      const result = await listComments({ prisma }, { pageId });
      if (result.kind !== 'ok') throw new Error('expected kind "ok"');

      const resolved = result.comments.find(
        (row) => row.comment === 'resolved inline after r3',
      );
      expect(resolved).toMatchObject({
        isInline: true,
        quote: 'quoted later',
        resolvedById: creatorId,
        creator: {
          id: creatorId,
          username: `list-comments-integ-${creatorId}`,
        },
      });

      const reply = result.comments.find(
        (row) => row.comment === 'inline reply between r2 and r3',
      );
      const parent = result.comments.find(
        (row) => row.comment === 'inline before r2',
      );
      expect(reply?.replyToId).toBe(parent?.id);
    });
  });

  describe('with a revision', () => {
    it('returns only comments created before the next revision, applying the same rule to replies', async () => {
      const result = await listComments({ prisma }, { pageId, revisionId: r1 });

      expect(commentsOf(result)).toEqual([
        'inline before r2',
        'normal reply before r2',
        'normal before r2',
      ]);
    });

    it('uses the oldest later revision as the boundary, not the latest one', async () => {
      const result = await listComments({ prisma }, { pageId, revisionId: r2 });

      expect(commentsOf(result)).toEqual([
        'inline reply between r2 and r3',
        'normal at r2',
        'inline before r2',
        'normal reply before r2',
        'normal before r2',
      ]);
    });

    it('does not filter by creation time when the revision is the latest one', async () => {
      const result = await listComments({ prisma }, { pageId, revisionId: r3 });

      expect(commentsOf(result)).toHaveLength(6);
    });

    it('returns revision-not-found for a revision of another page', async () => {
      const result = await listComments(
        { prisma },
        { pageId, revisionId: otherPageRevision },
      );

      expect(result).toEqual({ kind: 'revision-not-found' });
    });

    it('returns revision-not-found for a nonexistent revision', async () => {
      const result = await listComments(
        { prisma },
        { pageId, revisionId: new ObjectId().toString() },
      );

      expect(result).toEqual({ kind: 'revision-not-found' });
    });
  });
});
