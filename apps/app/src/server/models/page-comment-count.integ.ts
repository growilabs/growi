import { EventEmitter } from 'node:events';
import mongoose, { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import type { PageModel } from './page';

/**
 * Contract: once `Page.updateCommentCount` resolves, the stored
 * `pages.commentCount` already equals the number of comment rows on the page
 * (Requirement 7.4). The stored value is read right after the await, with no
 * waiting, so a write that is still in flight shows up as a stale value.
 */
describe('Page.updateCommentCount', () => {
  const { ObjectId } = Types;
  const pageId = new ObjectId();
  const revisionId = new ObjectId();
  const commentIds: string[] = [];
  let Page: PageModel;

  const readStoredCommentCount = async (): Promise<number | undefined> => {
    const doc = await mongoose.connection
      .collection('pages')
      .findOne({ _id: pageId });
    return doc?.commentCount;
  };

  const addComment = async (isInline: boolean): Promise<string> => {
    const created = await prisma.comments.create({
      data: {
        pageId: pageId.toString(),
        creatorId: new ObjectId().toString(),
        revisionId: revisionId.toString(),
        comment: 'comment',
        commentPosition: -1,
        isInline,
      },
    });
    commentIds.push(created.id);
    return created.id;
  };

  beforeAll(async () => {
    const crowi = mock<Crowi>({ events: { page: new EventEmitter() } });
    const pageModule = await import('./page');
    Page = pageModule.default(crowi);

    await prisma.pages.create({
      data: { id: pageId.toString(), path: '/comment-count-update', v: 0 },
    });
    await prisma.revisions.create({
      data: {
        id: revisionId.toString(),
        v: 0,
        authorId: new ObjectId().toString(),
        body: 'revision body',
        format: 'markdown',
        pageId: pageId.toString(),
      },
    });
  });

  afterAll(async () => {
    await prisma.comments.deleteMany({ where: { id: { in: commentIds } } });
    await prisma.revisions.deleteMany({ where: { id: revisionId.toString() } });
    await prisma.pages.deleteMany({ where: { id: pageId.toString() } });
  });

  it('has stored the total (normal + inline) as soon as the returned promise resolves', async () => {
    await addComment(false);
    await addComment(true);

    await Page.updateCommentCount(pageId);

    expect(await readStoredCommentCount()).toBe(2);
  });

  it('has stored the lower total right after a comment is removed', async () => {
    const removableId = await addComment(true);
    await Page.updateCommentCount(pageId);
    expect(await readStoredCommentCount()).toBe(3);

    await prisma.comments.deleteMany({ where: { id: removableId } });
    await Page.updateCommentCount(pageId);

    expect(await readStoredCommentCount()).toBe(2);
  });
});
