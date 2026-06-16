import { type IUserHasId, PageGrant } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

/**
 * Characterization test for the server premise that the pre-load race fix relies
 * on (issue #11272): when a page is updated WITHOUT a grant, the update endpoint
 * must preserve the page's existing grant rather than defaulting it.
 *
 * The editor omits the grant from the update request while selectedGrant is
 * unresolved (toPageUpdateGrantParams), so this preservation is what keeps a
 * restricted page from being silently published.
 */
describe('PageService.updatePage grant preservation', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUserHasId>;
  let user: HydratedDocument<IUserHasId>;

  const create = async (
    path: string,
    body: string,
    options = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const mockedCreateSubOperation = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());

    const createdPage = await crowi.pageService.create(
      path,
      body,
      user,
      options,
    );

    const argsForCreateSubOperation = mockedCreateSubOperation.mock.calls[0];
    mockedCreateSubOperation.mockRestore();
    await crowi.pageService.createSubOperation(
      ...(argsForCreateSubOperation as Parameters<
        typeof crowi.pageService.createSubOperation
      >),
    );

    return createdPage;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    // Suppress page events so their async listeners (e.g. obsolete-page onUpdate)
    // don't run DB work after the in-memory mongo is torn down. Same pattern as
    // page.integ.ts. The grant is set synchronously in create/updatePage, so this
    // does not affect what we assert.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    // updatePage fires updatePageSubOperation without awaiting it (descendant
    // bookkeeping). Stub it so that fire-and-forget DB work doesn't outlive the
    // test and hit the closed connection pool. The grant is already applied to the
    // saved page before this runs, so stubbing it doesn't affect the assertions.
    vi.spyOn(crowi.pageService, 'updatePageSubOperation').mockResolvedValue();

    // Ensure a root page exists so created pages can be attached to the tree.
    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    const username = 'grantPreserveUser';
    user =
      (await User.findOne({ username })) ??
      (await User.create({
        name: username,
        username,
        email: 'grant-preserve@example.com',
      }));
  });

  it('keeps GRANT_OWNER when the update omits a grant', async () => {
    const page = await create('/grant-preserve-owner', 'initial body', {
      grant: PageGrant.GRANT_OWNER,
    });
    expect(page.grant).toBe(PageGrant.GRANT_OWNER);

    const updated = await crowi.pageService.updatePage(
      page,
      'updated body',
      'initial body',
      user,
      {}, // no grant
    );

    expect(updated.grant).toBe(PageGrant.GRANT_OWNER);
  });

  it('changes the grant when the update explicitly provides one', async () => {
    const page = await create(
      '/grant-preserve-owner-to-public',
      'initial body',
      {
        grant: PageGrant.GRANT_OWNER,
      },
    );
    expect(page.grant).toBe(PageGrant.GRANT_OWNER);

    const updated = await crowi.pageService.updatePage(
      page,
      'updated body',
      'initial body',
      user,
      { grant: PageGrant.GRANT_PUBLIC },
    );

    expect(updated.grant).toBe(PageGrant.GRANT_PUBLIC);
  });
});
