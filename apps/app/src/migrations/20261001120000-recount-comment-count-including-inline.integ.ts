/**
 * Integration test for the comment count recount migration.
 *
 * Contract under test (observable DB state, Requirement 7.5):
 *  - a page that has inline comments gets its stored `commentCount` set to the
 *    number of ALL its comment rows (normal, inline, replies, resolved);
 *  - a page without inline comments is not touched, even when its stored count
 *    disagrees with its rows;
 *  - re-running yields the same result.
 */
import type { Collection } from 'mongodb';
import mongoose, { Types } from 'mongoose';

import { prisma } from '~/utils/prisma';

describe('recount-comment-count-including-inline', () => {
  const { ObjectId } = Types;
  let pagesCollection: Collection;
  let migrate: typeof import('./20261001120000-recount-comment-count-including-inline');

  const inlinePageId = new ObjectId().toString();
  const normalOnlyPageId = new ObjectId().toString();
  const pageIds = [inlinePageId, normalOnlyPageId];
  const revisionId = new ObjectId().toString();
  const commentIds: string[] = [];

  const createComment = async (
    pageId: string,
    isInline: boolean,
    extra: { replyToId?: string; resolved?: boolean } = {},
  ) => {
    const created = await prisma.comments.create({
      data: {
        pageId,
        creatorId: new ObjectId().toString(),
        revisionId,
        comment: 'recount migration fixture',
        commentPosition: -1,
        isInline,
        ...(isInline ? { quote: 'quoted text' } : {}),
        ...(extra.replyToId != null ? { replyToId: extra.replyToId } : {}),
        ...(extra.resolved
          ? { resolvedById: new ObjectId().toString(), resolvedAt: new Date() }
          : {}),
      },
    });
    commentIds.push(created.id);
    return created.id;
  };

  // Replies must go before their parents (relation restriction on delete)
  const deleteCreatedComments = async () => {
    await prisma.comments.deleteMany({
      where: { id: { in: commentIds }, replyToId: { not: null } },
    });
    await prisma.comments.deleteMany({ where: { id: { in: commentIds } } });
    commentIds.length = 0;
  };

  const readCommentCount = async (pageId: string) => {
    const doc = await pagesCollection.findOne({ _id: new ObjectId(pageId) });
    return doc?.commentCount;
  };

  beforeAll(async () => {
    migrate = await import(
      './20261001120000-recount-comment-count-including-inline'
    );
    pagesCollection = mongoose.connection.collection('pages');

    await prisma.pages.create({
      data: { id: inlinePageId, path: '/recount-migration-inline', v: 0 },
    });
    await prisma.pages.create({
      data: { id: normalOnlyPageId, path: '/recount-migration-normal', v: 0 },
    });
  });

  beforeEach(async () => {
    // Stale counts as written by the old counting (normal comments only)
    await deleteCreatedComments();

    await createComment(inlinePageId, false);
    const inlineId = await createComment(inlinePageId, true);
    await createComment(inlinePageId, true, { resolved: true });
    await createComment(inlinePageId, true, { replyToId: inlineId });
    await createComment(normalOnlyPageId, false);

    await pagesCollection.updateOne(
      { _id: new ObjectId(inlinePageId) },
      { $set: { commentCount: 1 } },
    );
    // Deliberately wrong: proves the migration does not touch this page
    await pagesCollection.updateOne(
      { _id: new ObjectId(normalOnlyPageId) },
      { $set: { commentCount: 7 } },
    );
  });

  afterAll(async () => {
    await deleteCreatedComments();
    await prisma.pages.deleteMany({ where: { id: { in: pageIds } } });
  });

  it('sets the count of a page with inline comments to all of its comment rows', async () => {
    await migrate.up();

    expect(await readCommentCount(inlinePageId)).toBe(4);
  });

  it('leaves a page without inline comments untouched', async () => {
    await migrate.up();

    expect(await readCommentCount(normalOnlyPageId)).toBe(7);
  });

  it('yields the same result when run twice', async () => {
    await migrate.up();
    await migrate.up();

    expect(await readCommentCount(inlinePageId)).toBe(4);
    expect(await readCommentCount(normalOnlyPageId)).toBe(7);
  });
});
