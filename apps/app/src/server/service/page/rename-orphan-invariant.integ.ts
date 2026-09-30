// A rename that fails midway must not leave the page off the tree.
// See https://github.com/growilabs/growi/issues/9755

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

  const snapshotTree = async () =>
    (
      await Page.find({ path: new RegExp(`^${base}`) }).sort({
        path: 1,
        _id: 1,
      })
    ).map((p) => ({
      path: p.path,
      parent: p.parent?.toString() ?? null,
      isEmpty: p.isEmpty ?? false,
    }));

  const findPathsOffTree = async () => {
    const pages = await Page.find({ path: new RegExp(`^${base}`) });
    const parents = await Page.find({
      _id: { $in: pages.map((p) => p.parent) },
    });
    const parentPathById = new Map(
      parents.map((p) => [p._id.toString(), p.path]),
    );
    return pages
      .filter(
        (p) =>
          parentPathById.get(p.parent?.toString() ?? '') !==
          pathlib.dirname(p.path),
      )
      .map((p) => p.path);
  };

  // Fails the write that moves the page to `newPath`, the last step of the rename.
  // `applied: true` lets the server apply it first, as a lost acknowledgement would.
  const renameWithFailingFinalWrite = async (
    page: PageDocument,
    newPath: string,
    { applied }: { applied: boolean },
  ) => {
    const originalFindByIdAndUpdate = Page.findByIdAndUpdate;
    const fault = new Error('simulated failure of the final write');
    const spy = vi
      .spyOn(Page, 'findByIdAndUpdate')
      .mockImplementation(function (this: PageModel, ...args) {
        const [, update] = args;
        const query = originalFindByIdAndUpdate.apply(this, args);
        if (update?.$set?.path !== newPath) return query;
        const failed = applied
          ? query.then(() => Promise.reject(fault))
          : Promise.reject(fault);
        // the caller only awaits the result, so a thenable can stand in for the Query
        return failed as unknown as typeof query;
      });
    try {
      const err = await rename(page, newPath);
      return { err, fault };
    } finally {
      spy.mockRestore();
    }
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

    // The real-world trigger. The rename may fail or succeed once the trashed-page
    // handling is fixed, so this only checks the page stays on the tree; the
    // injected-fault tests below are what prove the rollback runs.
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

    const { err, fault } = await renameWithFailingFinalWrite(target, newPath, {
      applied: true,
    });

    // otherwise the fault never fired and the assertion below proves nothing
    expect(err).toBe(fault);
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: newPath,
      parentPath: `${base}/new-parent`,
    });
    expect(await findPathsOffTree()).toEqual([]);
  });

  it('puts the page back under its old parent when renaming to a new location fails', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');

    const { err, fault } = await renameWithFailingFinalWrite(
      target,
      `${base}/new-parent/not-yet-existing/moved`,
      { applied: false },
    );

    expect(err).toBe(fault);
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: `${base}/ex-parent/target`,
      parentPath: `${base}/ex-parent`,
    });
  });

  it('restores the tree unchanged when renaming a page to under itself fails', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');
    await create(`${base}/target/child`, 'body');
    const before = await snapshotTree();

    const { err, fault } = await renameWithFailingFinalWrite(
      target,
      `${base}/target/not-yet-existing/moved`,
      { applied: false },
    );

    expect(err).toBe(fault);
    expect(await snapshotTree()).toEqual(before);
  });

  it('restores the tree unchanged when linking the new ancestors fails midway', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');
    const before = await snapshotTree();

    const fault = new Error(
      'simulated failure while linking the new ancestors',
    );
    const newPath = `${base}/target/not-yet-existing/moved`;
    let emptyAncestorsAtFault: string[] = [];
    const spy = vi.spyOn(Page, 'bulkWrite').mockImplementationOnce(async () => {
      const empties = await Page.find({
        path: new RegExp(`^${base}/`),
        isEmpty: true,
      });
      emptyAncestorsAtFault = empties.map((p) => p.path).sort();
      throw fault;
    });
    let err: Error | null;
    try {
      err = await rename(target, newPath);
    } finally {
      spy.mockRestore();
    }

    expect(err).toBe(fault);
    // the fault must hit after the empty ancestors were inserted, or nothing is left to clean up
    expect(emptyAncestorsAtFault).toEqual([
      `${base}/target`,
      `${base}/target/not-yet-existing`,
    ]);
    expect(await snapshotTree()).toEqual(before);
  });

  it('keeps the new ancestors when renaming to under itself commits but its acknowledgement is lost', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');
    const newPath = `${base}/target/not-yet-existing/moved`;

    const { err, fault } = await renameWithFailingFinalWrite(target, newPath, {
      applied: true,
    });

    expect(err).toBe(fault);
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: newPath,
      parentPath: `${base}/target/not-yet-existing`,
    });
    expect(await findPathsOffTree()).toEqual([]);
  });
});
