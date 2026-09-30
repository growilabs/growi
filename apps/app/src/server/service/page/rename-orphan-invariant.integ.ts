/**
 * #9755: a rename that fails midway must not leave the page detached from the tree.
 *
 * renameMainOperation detaches the page (`parent: null`) before resolving the new
 * parent, with no session around the two. A trashed destination parent makes that
 * resolution throw: it is public with `parent: null` and `status: deleted`, so
 * createEmptyPagesByPaths treats it as existing, while connectPageTree, which
 * requires STATUS_PUBLISHED, never re-parents it.
 */

import pathlib from 'node:path';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

describe('a failed rename must not orphan the page (#9755)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS module
  let User: Model<any>;
  // biome-ignore lint/suspicious/noExplicitAny: no User document type is available
  let user: any;

  const base = '/test-rename-orphan';

  const create = async (path: string, body: string, options = {}) => {
    const mocked = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());
    const createdPage = await crowi.pageService.create(
      path,
      body,
      user,
      options,
    );
    const args = mocked.mock.calls[0];
    mocked.mockRestore();
    await crowi.pageService.createSubOperation(
      ...(args as Parameters<typeof crowi.pageService.createSubOperation>),
    );
    return createdPage;
  };

  // renamePage does not await renameSubOperation; run it here so assertions don't race it
  const rename = async (
    page: PageDocument,
    newPagePath: string,
    options = {},
  ) => {
    const mocked = vi
      .spyOn(crowi.pageService, 'renameSubOperation')
      .mockReturnValue(Promise.resolve());
    try {
      await crowi.pageService.renamePage(page, newPagePath, user, options, {
        ip: '::ffff:127.0.0.1',
        endpoint: '/_api/v3/pages/rename',
      });
      const args = mocked.mock.calls[0];
      mocked.mockRestore();
      if (args != null) {
        await crowi.pageService.renameSubOperation(
          ...(args as Parameters<typeof crowi.pageService.renameSubOperation>),
        );
      }
      return null;
    } catch (err) {
      mocked.mockRestore();
      return err as Error;
    }
  };

  const findPathAndParentPath = async (pageId: PageDocument['_id']) => {
    const page = await Page.findById(pageId);
    const parent =
      page?.parent == null ? null : await Page.findById(page.parent);
    return { path: page?.path, parentPath: parent?.path };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    user =
      (await User.findOne({ username: 'renameOrphanUser' })) ??
      (await User.create({
        name: 'renameOrphanUser',
        username: 'renameOrphanUser',
        email: 'rename-orphan@example.com',
      }));
  });

  afterEach(async () => {
    await Page.deleteMany({
      path: { $in: [new RegExp(`^${base}`), new RegExp(`^/trash${base}`)] },
    });
  });

  it('leaves the page on the tree when the destination parent is a trashed page', async () => {
    await create(base, 'base body');
    const victim = await create(`${base}/deleted-later`, 'body');
    const target = await create(`${base}/target`, 'body');

    await crowi.pageService.deletePage(victim, user, {}, false, {
      ip: '::ffff:127.0.0.1',
      endpoint: '/_api/v3/pages/delete',
    });
    const trashed = await Page.findById(victim._id);
    expect(trashed?.parent).toBeNull();
    expect(trashed?.status).toBe('deleted');

    const err = await rename(target, `${trashed?.path}/moved`);

    // The rename may fail or succeed; either way the page must hang under the
    // page at its parent path.
    const { path, parentPath } = await findPathAndParentPath(target._id);
    expect(path).toBeDefined();
    expect(
      parentPath,
      `rename failed with "${err?.message}" and left "${path}" off the tree`,
    ).toBe(pathlib.dirname(path ?? ''));
  });

  it('keeps the new parent when the final write commits but its acknowledgement is lost', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const newPath = `${base}/new-parent/moved`;

    // The server applies the write that moves the page, but the caller sees an error
    const originalFindByIdAndUpdate = Page.findByIdAndUpdate;
    const lostAck = new Error('simulated lost acknowledgement');
    const spy = vi
      .spyOn(Page, 'findByIdAndUpdate')
      .mockImplementation(function (this: PageModel, ...args) {
        const [, update] = args;
        const query = originalFindByIdAndUpdate.apply(this, args);
        if (update?.$set?.path !== newPath) return query;
        // the caller only awaits the result, so a thenable can stand in for the Query
        return query.then(() => {
          throw lostAck;
        }) as unknown as typeof query;
      });

    let err: Error | null;
    try {
      err = await rename(target, newPath);
    } finally {
      spy.mockRestore();
    }

    // otherwise the fault never fired and the assertion below proves nothing
    expect(err).toBe(lostAck);

    expect(await findPathAndParentPath(target._id)).toEqual({
      path: newPath,
      parentPath: `${base}/new-parent`,
    });
  });
});
