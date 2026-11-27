/**
 * Integration tests — comment reactions follow the page's lifecycle:
 * complete deletion removes them, trash move / revert leaves them untouched.
 *
 * Runs against a real MongoDB: Prisma's `relationMode = "prisma"` checks only
 * run on a real client, so a mock cannot reveal a P2014 from the delete order.
 *
 * Requirements: 8.3, 8.4
 */
import type { IPage, IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

const TEST_IP = '10.0.0.77';
const TEST_ENDPOINT =
  '/_api/v3/pages/delete-completely-comment-reactions-integ';
const TEST_USERNAME = 'delete-completely-comment-reactions-integ-user';
const DELETE_PAGE_PATH = '/delete-completely-comment-reactions-integ-delete';
const TRASH_PAGE_PATH = '/delete-completely-comment-reactions-integ-trash';

describe('page lifecycle — comment reactions (read back from real DB)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;
  const pageIds: string[] = [];

  const createPage = async (path: string) => {
    const rootPage = await Page.findOne({ path: '/' });
    if (rootPage == null) {
      throw new Error('root page must exist (created in beforeAll)');
    }
    const [page] = await Page.insertMany([
      {
        path,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        lastUpdateUser: testUserId,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
    ]);
    pageIds.push(page._id.toString());
    return page;
  };

  // A comment with one reply, each holding reactions from several users.
  const seedCommentsWithReactions = async (pageId: string) => {
    const revisionId = new Types.ObjectId().toString();
    const comment = await prisma.comments.create({
      data: {
        pageId,
        creatorId: testUserId.toString(),
        revisionId,
        comment: 'comment with reactions',
        commentPosition: -1,
      },
    });
    const reply = await prisma.comments.create({
      data: {
        pageId,
        creatorId: testUserId.toString(),
        revisionId,
        comment: 'reply with reactions',
        commentPosition: -1,
        replyToId: comment.id,
      },
    });
    await prisma.commentreactions.createMany({
      data: [comment.id, reply.id].flatMap((commentId) =>
        ['unicode:+1', 'unicode:tada'].map((emoji) => ({
          commentId,
          pageId,
          userId: new Types.ObjectId().toString(),
          emoji,
        })),
      ),
    });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    await configManager.updateConfigs({ 'app:isV5Compatible': true });

    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }

    testUser = await crowi.models.User.create({
      name: 'Delete Completely Comment Reactions Integ User',
      username: TEST_USERNAME,
      email: 'delete-completely-comment-reactions-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  afterAll(async () => {
    await prisma.commentreactions.deleteMany({
      where: { pageId: { in: pageIds } },
    });
    await prisma.comments.deleteMany({
      where: { pageId: { in: pageIds }, replyToId: { not: null } },
    });
    await prisma.comments.deleteMany({ where: { pageId: { in: pageIds } } });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Page.deleteMany({
      path: {
        $in: [
          DELETE_PAGE_PATH,
          TRASH_PAGE_PATH,
          Page.getDeletedPageName(TRASH_PAGE_PATH),
        ],
      },
    });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    await configManager.updateConfigs(
      { 'app:isV5Compatible': undefined },
      { removeIfUndefined: true },
    );
  });

  it('req 8.3 — complete deletion removes the page reactions without throwing', async () => {
    const page = await createPage(DELETE_PAGE_PATH);
    const pageId = page._id.toString();
    await seedCommentsWithReactions(pageId);
    const otherPageId = new Types.ObjectId().toString();
    pageIds.push(otherPageId);
    await seedCommentsWithReactions(otherPageId);
    expect(await prisma.commentreactions.count({ where: { pageId } })).toBe(4);

    await crowi.pageService.deleteCompletely(page, testUser, {}, false, false, {
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });

    expect(await prisma.commentreactions.count({ where: { pageId } })).toBe(0);
    expect(await prisma.comments.count({ where: { pageId } })).toBe(0);
    expect(
      await prisma.commentreactions.count({ where: { pageId: otherPageId } }),
    ).toBe(4);
    expect(await Page.findById(page._id)).toBeNull();
  });

  it('req 8.4 — moving to trash and reverting leaves the reactions as they were', async () => {
    const page = await createPage(TRASH_PAGE_PATH);
    const pageId = page._id.toString();
    await seedCommentsWithReactions(pageId);
    const readReactions = async () =>
      (
        await prisma.commentreactions.findMany({
          where: { pageId },
          orderBy: { id: 'asc' },
        })
      ).map(({ id, commentId, userId, emoji, createdAt }) => ({
        id,
        commentId,
        userId,
        emoji,
        createdAt,
      }));
    const before = await readReactions();
    expect(before).toHaveLength(4);

    const trashed = await crowi.pageService.deletePage(
      page,
      testUser,
      {},
      false,
      { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    );
    expect(trashed.status).toBe(Page.STATUS_DELETED);
    expect(await prisma.commentreactions.count({ where: { pageId } })).toBe(4);

    await crowi.pageService.revertDeletedPage(trashed, testUser, {}, false, {
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });

    expect(await readReactions()).toEqual(before);
  });
});
