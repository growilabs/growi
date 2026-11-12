import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import SyncPageStatusService from './sync-page-status';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PAGE_PATH = `/sync-page-status-integ-${WORKER_ID}`;
const USERNAME = `sync-page-status-integ-${WORKER_ID}`;

describe('SyncPageStatusService on a grant-only page update', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let user: HydratedDocument<IUserHasId>;
  let page: HydratedDocument<PageDocument>;
  const laterUpdateListener = vi.fn();

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    await Page.deleteMany({ path: PAGE_PATH });
    await crowi.models.User.deleteMany({ username: USERNAME });
    user = await crowi.models.User.create({
      name: USERNAME,
      username: USERNAME,
      email: `${USERNAME}@example.com`,
    });

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }
    const root = await Page.findOne({ path: '/' }).orFail();
    page = await Page.create({
      path: PAGE_PATH,
      grant: PageGrant.GRANT_PUBLIC,
      creator: user._id,
      lastUpdateUser: user._id,
      parent: root._id,
    });
    const revision = await prisma.revisions.create({
      data: {
        pageId: String(page._id),
        body: 'body',
        format: 'markdown',
        authorId: String(user._id),
      },
    });
    page.revision = revision.id;
    await page.save();

    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();

    // The service is registered first, as in the running app.
    new SyncPageStatusService(crowi, undefined, crowi.socketIoService);
    crowi.events.page.on('update', laterUpdateListener);
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    crowi.events.page.off('update', laterUpdateListener);
    if (page != null) {
      await prisma.revisions.deleteMany({
        where: { pageId: String(page._id) },
      });
    }
    await Page.deleteMany({ path: PAGE_PATH });
    await crowi.models.User.deleteMany({ username: USERNAME });
  });

  it('lets the update succeed and reach the listeners registered after it', async () => {
    const updated = await crowi.pageService.updateGrant(page, user, {
      grant: PageGrant.GRANT_OWNER,
      userRelatedGrantedGroups: [],
    });

    expect(updated.grant).toBe(PageGrant.GRANT_OWNER);
    expect(laterUpdateListener).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ _id: page._id }),
      user,
    );
  });
});
