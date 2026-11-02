import { type IUserHasId, PageGrant } from '@growi/core';
import mongoose, { type HydratedDocument } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import PageService from '~/server/service/page';
import { prisma } from '~/utils/prisma';

const FIXTURE_NAME = 'empty-trash-page-integ';
const operatorUsername = `${FIXTURE_NAME}-operator`;

// Sentinel ip so cleanup removes only the activity rows this suite created.
const TEST_IP = '10.0.0.117';

const fixturePathPattern = new RegExp(`^(/trash)?/${FIXTURE_NAME}(/|$)`);

describe('PageService.emptyTrashPage', () => {
  let crowi: Crowi;
  // emptyTrashPage is not part of the IPageService interface
  let pageService: PageService;
  let operator: HydratedDocument<IUserHasId>;

  const createPage = (path: string, status: 'deleted' | 'published') =>
    crowi.models.Page.create({
      path,
      grant: PageGrant.GRANT_PUBLIC,
      status,
      creator: operator._id,
      lastUpdateUser: operator._id,
      parent: null,
    });

  const removeFixtures = async (): Promise<void> => {
    await crowi.models.Page.deleteMany({ path: fixturePathPattern });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  };

  beforeAll(async () => {
    crowi = await getInstance();
    if (!(crowi.pageService instanceof PageService)) {
      throw new Error(
        'crowi.pageService is expected to be the concrete PageService',
      );
    }
    pageService = crowi.pageService;

    const User = mongoose.model<IUserHasId>('User');
    await User.deleteMany({ username: operatorUsername });
    operator = await User.create({
      name: operatorUsername,
      username: operatorUsername,
      email: `${operatorUsername}@example.com`,
    });
  });

  beforeEach(removeFixtures);

  afterAll(async () => {
    await removeFixtures();
    await crowi.models.User.deleteMany({ username: operatorUsername });
  });

  it('deletes only the given trashed pages', async () => {
    const listed = await createPage(`/trash/${FIXTURE_NAME}/listed`, 'deleted');
    const notListed = await createPage(
      `/trash/${FIXTURE_NAME}/not-listed`,
      'deleted',
    );

    await pageService.emptyTrashPage(operator, { ip: TEST_IP }, [listed._id]);

    expect(await crowi.models.Page.findById(listed._id)).toBeNull();
    expect((await crowi.models.Page.findById(notListed._id))?.path).toBe(
      notListed.path,
    );
  });

  it('keeps a given page that is no longer in the trash', async () => {
    const restored = await createPage(`/${FIXTURE_NAME}/restored`, 'published');

    await pageService.emptyTrashPage(operator, { ip: TEST_IP }, [restored._id]);

    expect((await crowi.models.Page.findById(restored._id))?.path).toBe(
      restored.path,
    );
  });
});
