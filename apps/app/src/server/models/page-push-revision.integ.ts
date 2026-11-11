import type { IUserHasId } from '@growi/core';
import { isPopulated } from '@growi/core/dist/interfaces';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { RevisionConflictError } from '~/server/models/errors';
import { type PageDocument, pushRevision } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

const PAGE_PATH_PREFIX = '/page-push-revision';

const populatedBody = (page: PageDocument): string | undefined =>
  page.revision != null && isPopulated(page.revision)
    ? page.revision.body
    : undefined;

describe('pushRevision', () => {
  let user: IUserHasId;
  let Page: Model<PageDocument>;
  let pageSeq = 0;

  beforeAll(async () => {
    await getInstance();
    const User = mongoose.model<IUserHasId>('User');
    user = await User.create({
      name: 'pushRevisionUser',
      username: 'pushRevisionUser',
      email: 'pushRevisionUser@example.com',
    });
    Page = mongoose.model<PageDocument>('Page');
  });

  afterAll(async () => {
    const pages = await Page.find({
      path: new RegExp(`^${PAGE_PATH_PREFIX}`),
    });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pages.map((p) => p._id.toString()) } },
    });
    await Page.deleteMany({ path: new RegExp(`^${PAGE_PATH_PREFIX}`) });
    await mongoose.model('User').deleteMany({ username: 'pushRevisionUser' });
  });

  // Seeds a page whose latest revision is a real revision document.
  const seedPage = async (): Promise<{
    pageId: string;
    initialRevisionId: string;
  }> => {
    pageSeq += 1;
    const page = await Page.create({
      path: `${PAGE_PATH_PREFIX}-${pageSeq}`,
      grant: 1,
    });
    const initial = await prisma.revisions.create({
      data: prisma.revisions.prepareRevision(
        page,
        'initial body',
        null,
        user,
        undefined,
      ),
    });
    await Page.updateOne(
      { _id: page._id },
      { $set: { revision: initial._id, latestRevisionBodyLength: 12 } },
    );
    return { pageId: page._id.toString(), initialRevisionId: initial.id };
  };

  const loadPage = async (
    pageId: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await Page.findById(pageId);
    if (page == null) throw new Error(`page ${pageId} not found`);
    return page;
  };

  const countRevisions = (pageId: string): Promise<number> =>
    prisma.revisions.count({ where: { pageId } });

  const push = async (
    pageId: string,
    body: string,
    options?: { expectedRevisionId?: string },
  ) => {
    const page = await loadPage(pageId);
    const data = prisma.revisions.prepareRevision(
      page,
      body,
      null,
      user,
      undefined,
    );
    return pushRevision(page, data, user, options);
  };

  describe('with expectedRevisionId', () => {
    it('writes the new revision when the page still points at the expected revision', async () => {
      const { pageId, initialRevisionId } = await seedPage();

      const saved = await push(pageId, 'next body', {
        expectedRevisionId: initialRevisionId,
      });

      const reloaded = await loadPage(pageId);
      expect(reloaded.revision?.toString()).not.toBe(initialRevisionId);
      expect(reloaded.latestRevisionBodyLength).toBe('next body'.length);
      expect(saved._id.toString()).toBe(pageId);
      // The returned page carries the populated new revision, like the unconditional path.
      expect(populatedBody(saved)).toBe('next body');
      expect(await countRevisions(pageId)).toBe(2);
    });

    it('throws RevisionConflictError, leaves the page unchanged and keeps no new revision when the expected revision is stale', async () => {
      const { pageId, initialRevisionId } = await seedPage();
      // Another save moves the page forward first.
      await push(pageId, 'other writer body');
      const before = (await loadPage(pageId)).toObject();
      const revisionCountBefore = await countRevisions(pageId);

      await expect(
        push(pageId, 'stale body', { expectedRevisionId: initialRevisionId }),
      ).rejects.toBeInstanceOf(RevisionConflictError);

      const after = (await loadPage(pageId)).toObject();
      expect(after.revision?.toString()).toBe(before.revision?.toString());
      expect(after.latestRevisionBodyLength).toBe(
        before.latestRevisionBodyLength,
      );
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await countRevisions(pageId)).toBe(revisionCountBefore);
      expect(
        await prisma.revisions.count({
          where: { pageId, body: 'stale body' },
        }),
      ).toBe(0);
    });

    // Repeated to give the race many chances to interleave both ways.
    it.each(
      Array.from({ length: 20 }, (_, i) => i),
    )('lets exactly one of two concurrent writers expecting the same revision win (#%i)', async (i) => {
      const { pageId, initialRevisionId } = await seedPage();

      const results = await Promise.allSettled([
        push(pageId, `writer A ${i}`, {
          expectedRevisionId: initialRevisionId,
        }),
        push(pageId, `writer B ${i}`, {
          expectedRevisionId: initialRevisionId,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(RevisionConflictError);

      const winnerBody = populatedBody(fulfilled[0].value);
      const reloaded = await loadPage(pageId);
      const latest = await prisma.revisions.findUniqueOrThrow({
        where: { id: reloaded.revision?.toString() },
      });
      expect(latest.body).toBe(winnerBody);
      // Initial revision plus the winner's only; the loser's revision is gone.
      expect(await countRevisions(pageId)).toBe(2);
    });
  });

  describe('without expectedRevisionId', () => {
    it('writes unconditionally even when the loaded page is stale', async () => {
      const { pageId } = await seedPage();
      const stalePage = await loadPage(pageId);
      await push(pageId, 'other writer body');

      const data = prisma.revisions.prepareRevision(
        stalePage,
        'last writer body',
        null,
        user,
        undefined,
      );
      await pushRevision(stalePage, data, user);

      const reloaded = await loadPage(pageId);
      const latest = await prisma.revisions.findUniqueOrThrow({
        where: { id: reloaded.revision?.toString() },
      });
      expect(latest.body).toBe('last writer body');
      expect(await countRevisions(pageId)).toBe(3);
    });
  });
});
