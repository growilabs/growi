import type { IUserHasId } from '@growi/core';
import type { HydratedDocument, Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

/**
 * A page created at a path that still carries a redirect is unreachable at its own
 * path: page view resolves a requested path through its redirect
 * (`resolvePathAndCheckIdentical`) without ever looking for a live page at it. So
 * creating a page has to clear the redirect for its path, and has to do it where a
 * failure can still be acted on — not from a sub-operation the caller never awaits.
 */
describe('PageService.create with a redirect on the target path', () => {
  const PREFIX = '/create-redirect-integ';

  let crowi: Crowi;
  let Page: PageModel;
  let User: Model<IUserHasId>;
  let user: HydratedDocument<IUserHasId>;

  /**
   * Creates without ever running the sub operation, since what is under test is
   * that the awaited part of `create` clears the redirect on its own.
   */
  const createWithoutSubOperation = async (
    path: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const mockedCreateSubOperation = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());

    try {
      return await crowi.pageService.create(path, 'body', user, {});
    } finally {
      mockedCreateSubOperation.mockRestore();
    }
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    User = mongoose.model<IUserHasId>('User');
    Page = mongoose.model<PageDocument, PageModel>('Page');

    // Suppress page events so their async listeners don't run DB work after the
    // in-memory mongo is torn down (same pattern as grant-preserve-on-update).
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    const username = 'createRedirectUser';
    user =
      (await User.findOne({ username })) ??
      (await User.create({
        name: username,
        username,
        email: 'create-redirect@example.com',
      }));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}/`) });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: `${PREFIX}/` } },
    });
  });

  it('has deleted the redirect by the time create resolves', async () => {
    const path = `${PREFIX}/reused`;
    await prisma.pageredirects.create({
      data: { fromPath: path, toPath: `${PREFIX}/moved-to` },
    });

    await createWithoutSubOperation(path);

    expect(
      await prisma.pageredirects.findFirst({ where: { fromPath: path } }),
    ).toBeNull();
  });

  // Every delegate method on the `$extends`-wrapped `prisma` client --
  // built-in CRUD verbs and custom extension methods like `deleteByFromPath`
  // alike -- is exposed through a Proxy `get` trap rather than a real own
  // property (see the note at `deleteByFromPath`'s definition in
  // `page-redirect.ts`). `vi.spyOn` captures the "original" via
  // `Object.getOwnPropertyDescriptor`, which the Proxy reports as a fake
  // descriptor (`value: undefined`) for every such method, so
  // `mockRestore()`/`vi.restoreAllMocks()` reinstalls `undefined` instead of
  // the real function -- permanently breaking every later call to
  // `prisma.pageredirects.deleteByFromPath` in this module. The third test
  // below calls the real implementation via `createWithoutSubOperation`, so
  // this file can't use `vi.spyOn` here. A plain manual save/restore
  // sidesteps that: reading the property directly (not via
  // `getOwnPropertyDescriptor`) returns the real function, so restoring by
  // assignment puts back the right thing regardless of test order.
  it('creates no page when the redirect cannot be deleted', async () => {
    const path = `${PREFIX}/undeletable`;
    await prisma.pageredirects.create({
      data: { fromPath: path, toPath: `${PREFIX}/moved-to` },
    });
    const originalDeleteByFromPath = prisma.pageredirects.deleteByFromPath;
    prisma.pageredirects.deleteByFromPath = () => {
      throw new Error('simulated failure to delete the redirect');
    };

    try {
      await expect(createWithoutSubOperation(path)).rejects.toThrow();
    } finally {
      prisma.pageredirects.deleteByFromPath = originalDeleteByFromPath;
    }

    // Neither half of the inconsistent state was left behind: the page was not
    // created, and the redirect that could not be deleted is still there.
    expect(await Page.findOne({ path })).toBeNull();
    expect(
      await prisma.pageredirects.findFirst({ where: { fromPath: path } }),
    ).not.toBeNull();
  });

  it('creates a page normally when the path has no redirect', async () => {
    const path = `${PREFIX}/fresh`;

    const page = await createWithoutSubOperation(path);

    expect(page.path).toBe(path);
    expect(await Page.findOne({ path })).not.toBeNull();
  });
});
