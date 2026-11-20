import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

describe('grant of the pages that must stay public', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUserHasId>;
  let user: HydratedDocument<IUserHasId>;

  const createWithoutSubOperation = async (
    path: string,
    options: Record<string, unknown> = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const mockedCreateSubOperation = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());

    try {
      return await crowi.pageService.create(path, 'body', user, options);
    } finally {
      mockedCreateSubOperation.mockRestore();
    }
  };

  const makeOwnerOnly = (page: HydratedDocument<PageDocument>) =>
    crowi.pageService.updateGrant(page, user, {
      grant: PageGrant.GRANT_OWNER,
      userRelatedGrantedGroups: [],
    });

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();

    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    const username = 'protectedPageGrantUser';
    user =
      (await User.findOne({ username })) ??
      (await User.create({
        name: username,
        username,
        email: 'protected-page-grant@example.com',
      }));
  });

  it('rejects creating /user with a grant other than public', async () => {
    await expect(
      createWithoutSubOperation('/user', { grant: PageGrant.GRANT_OWNER }),
    ).rejects.toThrow(/must be public/);

    expect(await Page.exists({ path: '/user' })).toBeNull();
  });

  it('allows changing the grant of an ordinary page', async () => {
    const page = await createWithoutSubOperation('/ordinary-grant-change');

    const updated = await makeOwnerOnly(page);

    expect(updated.grant).toBe(PageGrant.GRANT_OWNER);
  });

  it('rejects changing the grant of /user and leaves it public', async () => {
    const usersTop = await createWithoutSubOperation('/user');
    expect(usersTop.grant).toBe(PageGrant.GRANT_PUBLIC);

    await expect(makeOwnerOnly(usersTop)).rejects.toThrow(
      /grant settings .* cannot be modified/,
    );

    const reloaded = await Page.findById(usersTop._id);
    expect(reloaded?.grant).toBe(PageGrant.GRANT_PUBLIC);
  });

  it('keeps the grant when an update sends the unchanged grant', async () => {
    const usersTop = await Page.findOne({ path: '/user' });
    expect(usersTop).not.toBeNull();

    const updated = await crowi.pageService.updatePage(
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      usersTop!,
      'edited',
      'body',
      user,
      { grant: PageGrant.GRANT_PUBLIC },
    );

    expect(updated.grant).toBe(PageGrant.GRANT_PUBLIC);
  });

  it('rejects changing the grant of the top page /', async () => {
    const top = await Page.findOne({ path: '/' });
    expect(top).not.toBeNull();

    await expect(
      // biome-ignore lint/style/noNonNullAssertion: asserted above
      makeOwnerOnly(top!),
    ).rejects.toThrow(/grant settings .* cannot be modified/);
  });
});
