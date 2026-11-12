import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';
const PATH_PREFIX = `/apply-scopes-to-descendants-integ-${WORKER_ID}`;
const USERNAME = `apply-scopes-to-descendants-integ-${WORKER_ID}`;

describe('PageService: applying a grant to descendants', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let user: HydratedDocument<IUserHasId>;
  const onSyncDescendantsUpdate = vi.fn();

  const createParentWithChildren = async (
    name: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const root = await Page.findOne({ path: '/' }).orFail();
    const parent = await Page.create({
      path: `${PATH_PREFIX}/${name}`,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [user._id],
      creator: user._id,
      parent: root._id,
    });
    await Page.create(
      ['child1', 'child2'].map((child) => ({
        path: `${PATH_PREFIX}/${name}/${child}`,
        grant: PageGrant.GRANT_PUBLIC,
        creator: user._id,
        parent: parent._id,
      })),
    );
    return parent;
  };

  const applyGrantToDescendants = (
    parent: HydratedDocument<PageDocument>,
  ): Promise<void> =>
    // biome-ignore lint/complexity/useLiteralKeys: the method under test is private
    crowi.pageService['applyScopesToDescendantsWithStream'](parent, user);

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    await Page.deleteMany({ path: { $regex: `^${PATH_PREFIX}/` } });
    await crowi.models.User.deleteMany({ username: USERNAME });
    user = await crowi.models.User.create({
      name: USERNAME,
      username: USERNAME,
      email: `${USERNAME}@example.com`,
    });
    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }

    crowi.events.page.on('syncDescendantsUpdate', onSyncDescendantsUpdate);
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
    onSyncDescendantsUpdate.mockClear();
  });

  afterAll(async () => {
    crowi.events.page.off('syncDescendantsUpdate', onSyncDescendantsUpdate);
    await Page.deleteMany({ path: { $regex: `^${PATH_PREFIX}/` } });
    await crowi.models.User.deleteMany({ username: USERNAME });
  });

  it('asks for a re-index of the descendants once after rewriting them', async () => {
    const parent = await createParentWithChildren('success');

    await applyGrantToDescendants(parent);

    const children = await Page.find({ parent: parent._id });
    expect(children.map((child) => child.grant)).toEqual([
      PageGrant.GRANT_OWNER,
      PageGrant.GRANT_OWNER,
    ]);
    expect(onSyncDescendantsUpdate).toHaveBeenCalledExactlyOnceWith(
      parent,
      user,
    );
  });

  it('still asks for the re-index and surfaces the error when a batch fails', async () => {
    const parent = await createParentWithChildren('failure');
    const batchError = new Error('batch failed');
    vi.spyOn(Page, 'bulkWrite').mockRejectedValue(batchError);

    await expect(applyGrantToDescendants(parent)).rejects.toBe(batchError);

    expect(onSyncDescendantsUpdate).toHaveBeenCalledExactlyOnceWith(
      parent,
      user,
    );
  }, 10_000);
});
