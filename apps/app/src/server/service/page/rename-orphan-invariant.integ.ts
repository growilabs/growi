// A rename that fails midway must not leave the page off the tree.
// See https://github.com/growilabs/growi/issues/9755

import pathlib from 'node:path';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

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
  // `onFault` runs just before an unapplied write fails, to record the tree at that moment.
  const renameWithFailingFinalWrite = async (
    page: PageDocument,
    newPath: string,
    {
      applied,
      onFault,
      options,
    }: {
      applied: boolean;
      onFault?: () => Promise<void>;
      options?: Record<string, unknown>;
    },
  ) => {
    const originalFindByIdAndUpdate = Page.findByIdAndUpdate;
    const fault = new Error('simulated failure of the final write');
    let faultFired = false;
    const failingBeforeWrite = (
      query: ReturnType<typeof Page.findByIdAndUpdate>,
    ) => {
      const failing = query.error(fault);
      const exec = failing.exec.bind(failing);
      failing.exec = async (...execArgs: Parameters<typeof exec>) => {
        await onFault?.();
        return exec(...execArgs);
      };
      return failing;
    };
    const spy = vi
      .spyOn(Page, 'findByIdAndUpdate')
      .mockImplementation(function (this: PageModel, ...args) {
        const [, update] = args;
        const query = originalFindByIdAndUpdate.apply(this, args);
        if (update?.$set?.path !== newPath) return query;
        // Both stay real Queries, so callers may still chain .exec() / .lean():
        // `transform` throws after the write ran, `error` rejects before it runs.
        return applied
          ? query.transform(() => {
              faultFired = true;
              throw fault;
            })
          : failingBeforeWrite(query);
      });
    try {
      const err = await rename(page, newPath, options);
      return { err, fault, faultFired };
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
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: base } },
    });
  });

  it('leaves the page on the tree after renaming it under a trashed page, whether or not the rename succeeds', async () => {
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
    const findEmptyTrashPaths = async () =>
      (await Page.find({ path: /^\/trash/, isEmpty: true }))
        .map((p) => p.path)
        .sort();
    const emptyTrashPathsBefore = await findEmptyTrashPaths();

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
    if (err != null) {
      // a failed rename also takes back the empty ancestors it created above the trashed page
      expect(await findEmptyTrashPaths()).toEqual(emptyTrashPathsBefore);
    }
  });

  // Builds two five-page trees (one control, one subject) and renames each
  // -- around a dozen real page-create/rename round-trips in series -- which
  // can exceed the project's default 5000ms testTimeout under CI load (#12194).
  it('completes the rename, children included, when the final write commits but its acknowledgement is lost', async () => {
    await create(base, 'base body');
    const createTree = async (root: string) => {
      await create(root, 'body');
      await create(`${root}/ex-parent`, 'body');
      await create(`${root}/new-parent`, 'body');
      const target = await create(`${root}/ex-parent/target`, 'body');
      const child = await create(`${root}/ex-parent/target/child`, 'body');
      return { target, child };
    };
    const descendantCountsUnder = async (root: string) =>
      (
        await Page.find({ path: new RegExp(`^${root}/`) }).sort({ path: 1 })
      ).map((p) => [p.path.slice(root.length), p.descendantCount]);
    const options = { createRedirectPage: true };

    // a rename that succeeds outright, to compare against
    const control = `${base}/control`;
    const controlTree = await createTree(control);
    expect(
      await rename(controlTree.target, `${control}/new-parent/moved`, options),
    ).toBeNull();

    const subject = `${base}/subject`;
    const { target, child } = await createTree(subject);
    const newPath = `${subject}/new-parent/moved`;
    const { err, faultFired } = await renameWithFailingFinalWrite(
      target,
      newPath,
      { applied: true, options },
    );

    // otherwise the fault never fired and the assertions below prove nothing
    expect(faultFired).toBe(true);
    expect(err).toBeNull();
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: newPath,
      parentPath: `${subject}/new-parent`,
    });
    expect(await findPathAndParentPath(child._id)).toEqual({
      path: `${newPath}/child`,
      parentPath: newPath,
    });
    expect(await findPathsOffTree()).toEqual([]);
    // the rest of the rename ran as it does when nothing fails
    expect(
      await prisma.pageredirects.findFirst({
        where: { fromPath: `${subject}/ex-parent/target` },
      }),
    ).toEqual(expect.objectContaining({ toPath: newPath }));
    expect(await descendantCountsUnder(subject)).toEqual(
      await descendantCountsUnder(control),
    );
  }, 20_000);

  it('restores the tree unchanged, new empty ancestors included, when renaming to a new location fails', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const before = await snapshotTree();

    let emptyAncestorsAtFault: string[] = [];
    const { err, fault } = await renameWithFailingFinalWrite(
      target,
      `${base}/new-parent/not-yet-existing/deeper/moved`,
      {
        applied: false,
        onFault: async () => {
          const empties = await Page.find({
            path: new RegExp(`^${base}/new-parent/`),
            isEmpty: true,
          });
          emptyAncestorsAtFault = empties.map((p) => p.path).sort();
        },
      },
    );

    expect(err).toBe(fault);
    // the fault must hit after the new ancestors were created, or nothing is left to clean up
    expect(emptyAncestorsAtFault).toEqual([
      `${base}/new-parent/not-yet-existing`,
      `${base}/new-parent/not-yet-existing/deeper`,
    ]);
    expect(await snapshotTree()).toEqual(before);
  });

  it('keeps an existing empty ancestor that still has other children when renaming to a new location fails', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    // creating a page under a missing path leaves an empty page at `${base}/holder`
    await create(`${base}/holder/other-child`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const before = await snapshotTree();
    expect(before).toContainEqual(
      expect.objectContaining({ path: `${base}/holder`, isEmpty: true }),
    );

    const { err, fault } = await renameWithFailingFinalWrite(
      target,
      `${base}/holder/not-yet-existing/moved`,
      { applied: false },
    );

    expect(err).toBe(fault);
    expect(await snapshotTree()).toEqual(before);
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

  it('restores the tree unchanged when inserting the new ancestors fails partway', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');
    const before = await snapshotTree();

    const fault = new Error('simulated failure while inserting the ancestors');
    const realInsertMany = Page.insertMany.bind(Page);
    let emptyAncestorsAtFault: string[] = [];
    const spy = vi
      .spyOn(Page, 'insertMany')
      // only the empty page at the target's own path gets in, then the insert fails
      .mockImplementationOnce(async (docs) => {
        const docsToInsert = Array.isArray(docs) ? docs : [docs];
        await realInsertMany(
          docsToInsert.filter((doc) => doc.path === target.path),
        );
        const empties = await Page.find({
          path: new RegExp(`^${base}/`),
          isEmpty: true,
        });
        emptyAncestorsAtFault = empties.map((p) => p.path);
        throw fault;
      });
    let err: Error | null;
    try {
      err = await rename(target, `${base}/target/not-yet-existing/moved`);
    } finally {
      spy.mockRestore();
    }

    expect(err).toBe(fault);
    // otherwise the insert never got in and nothing is left to clean up
    expect(emptyAncestorsAtFault).toEqual([`${base}/target`]);
    expect(await snapshotTree()).toEqual(before);
  });

  it('fails without touching the tree when the destination is under the page only by case', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/Target`, 'body');
    const before = await snapshotTree();

    // no rollback can succeed (this fails the rollback's write), so the tree only
    // stays as it was if nothing was written
    const originalUpdateOne = Page.updateOne;
    const updateOneSpy = vi
      .spyOn(Page, 'updateOne')
      .mockImplementation(function (this: PageModel, ...args) {
        return originalUpdateOne
          .apply(this, args)
          .error(new Error('simulated failure of the rollback'));
      });
    let err: Error | null;
    try {
      err = await rename(target, `${base}/target/moved`);
    } finally {
      updateOneSpy.mockRestore();
    }

    expect(err).not.toBeNull();
    expect(await snapshotTree()).toEqual(before);
  });

  it('surfaces the original error and names the leftover empty pages when removing them also fails', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');

    const linkFault = new Error(
      'simulated failure while linking the new ancestors',
    );
    const cleanupFault = new Error(
      'simulated failure while removing the new ancestors',
    );
    let failedDeletes = 0;
    const bulkWriteSpy = vi
      .spyOn(Page, 'bulkWrite')
      .mockRejectedValueOnce(linkFault);
    // every delete fails, so the test holds wherever the cleanup lives
    const deleteManySpy = vi
      .spyOn(Page, 'deleteMany')
      .mockImplementation(() => {
        failedDeletes += 1;
        throw cleanupFault;
      });
    const errorSpy = vi.spyOn(loggerFactory('growi:services:page'), 'error');
    let err: Error | null;
    // read before mockRestore, which discards the recorded calls
    let logged = '';
    try {
      err = await rename(target, `${base}/target/not-yet-existing/moved`);
      logged = errorSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .join('\n');
    } finally {
      bulkWriteSpy.mockRestore();
      deleteManySpy.mockRestore();
      errorSpy.mockRestore();
    }

    // otherwise the cleanup never failed and the assertions below prove nothing
    expect(failedDeletes).toBeGreaterThan(0);
    expect(err).toBe(linkFault);
    // the rollback still ran past the failed cleanup
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: `${base}/target`,
      parentPath: base,
    });
    // the log is the only way left to find the empty pages that could not be removed
    const leftovers = await Page.find({
      path: new RegExp(`^${base}/`),
      isEmpty: true,
    });
    expect(leftovers).toHaveLength(2);
    for (const leftover of leftovers) {
      expect(logged).toContain(leftover._id.toString());
    }
  });

  it('leaves a page that was moved elsewhere in the meantime, and the new ancestors, alone when the rename fails', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');
    const elsewhere = await create(`${base}/elsewhere`, 'body');
    const newPath = `${base}/target/not-yet-existing/moved`;

    // Another writer reattaches the page right after the rename detaches it,
    // which is what the rollback's `parent: null` condition guards against.
    const originalTakeOffFromTree = Page.takeOffFromTree;
    const takeOffSpy = vi
      .spyOn(Page, 'takeOffFromTree')
      .mockImplementation(async function (this: PageModel, ...args) {
        const detached = await originalTakeOffFromTree.apply(this, args);
        await Page.updateOne(
          { _id: target._id },
          { $set: { parent: elsewhere._id } },
        );
        return detached;
      });
    const warnSpy = vi.spyOn(loggerFactory('growi:services:page'), 'warn');
    let result: Awaited<ReturnType<typeof renameWithFailingFinalWrite>>;
    // read before mockRestore, which discards the recorded calls
    let warnings: string[] = [];
    try {
      result = await renameWithFailingFinalWrite(target, newPath, {
        applied: false,
      });
      warnings = warnSpy.mock.calls.map(([message]) => String(message));
    } finally {
      takeOffSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(result.err).toBe(result.fault);
    // (a) the rollback did not overwrite the other writer's change
    expect((await Page.findById(target._id))?.parent?.toString()).toBe(
      elsewhere._id.toString(),
    );
    // (b) the empty pages the rename inserted are kept, not deleted
    const empties = await Page.find({
      path: new RegExp(`^${base}/`),
      isEmpty: true,
    });
    expect(empties.map((p) => p.path).sort()).toEqual([
      `${base}/target`,
      `${base}/target/not-yet-existing`,
    ]);
    // (c) the skipped rollback is reported
    expect(warnings).toContainEqual(expect.stringContaining(`${base}/target`));
  });

  it('completes the rename to under itself, children included, when the final write commits but its acknowledgement is lost', async () => {
    await create(base, 'base body');
    const target = await create(`${base}/target`, 'body');
    const child = await create(`${base}/target/child`, 'body');
    const newPath = `${base}/target/not-yet-existing/moved`;

    const { err, faultFired } = await renameWithFailingFinalWrite(
      target,
      newPath,
      { applied: true },
    );

    expect(faultFired).toBe(true);
    expect(err).toBeNull();
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: newPath,
      parentPath: `${base}/target/not-yet-existing`,
    });
    expect(await findPathAndParentPath(child._id)).toEqual({
      path: `${newPath}/child`,
      parentPath: newPath,
    });
    expect(await findPathsOffTree()).toEqual([]);
  });

  it('restores the tree unchanged when creating the new ancestors fails before they are linked', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const before = await snapshotTree();

    const fault = new Error('simulated failure after creating the ancestors');
    const realCreateEmptyPagesByPaths = Page.createEmptyPagesByPaths.bind(Page);
    let emptyAncestorsAtFault: { path: string; parent: string | null }[] = [];
    const spy = vi
      .spyOn(Page, 'createEmptyPagesByPaths')
      .mockImplementationOnce(async (...args) => {
        await realCreateEmptyPagesByPaths(...args);
        const empties = await Page.find({
          path: new RegExp(`^${base}/new-parent/`),
          isEmpty: true,
        }).sort({ path: 1 });
        emptyAncestorsAtFault = empties.map((p) => ({
          path: p.path,
          parent: p.parent?.toString() ?? null,
        }));
        throw fault;
      });
    let err: Error | null;
    try {
      err = await rename(
        target,
        `${base}/new-parent/not-yet-existing/deeper/moved`,
      );
    } finally {
      spy.mockRestore();
    }

    expect(err).toBe(fault);
    // the fault must hit after the ancestors were created and before they were linked
    expect(emptyAncestorsAtFault).toEqual([
      { path: `${base}/new-parent/not-yet-existing`, parent: null },
      { path: `${base}/new-parent/not-yet-existing/deeper`, parent: null },
    ]);
    expect(await snapshotTree()).toEqual(before);
  });

  it('removes the new empty ancestors above an off-tree page on the way when the rename fails', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    // an off-tree page with no page above it, as a page left unmigrated is
    const offTree = await create(`${base}/missing/off-tree`, 'body');
    await Page.deleteOne({ path: `${base}/missing`, isEmpty: true });
    await Page.updateOne({ _id: offTree._id }, { $set: { parent: null } });
    const before = await snapshotTree();

    const fault = new Error('simulated failure after creating the ancestors');
    const realCreateEmptyPagesByPaths = Page.createEmptyPagesByPaths.bind(Page);
    let emptyAncestorsAtFault: string[] = [];
    const spy = vi
      .spyOn(Page, 'createEmptyPagesByPaths')
      .mockImplementationOnce(async (...args) => {
        await realCreateEmptyPagesByPaths(...args);
        const empties = await Page.find({
          path: new RegExp(`^${base}/missing`),
          isEmpty: true,
        });
        emptyAncestorsAtFault = empties.map((p) => p.path).sort();
        throw fault;
      });
    let err: Error | null;
    try {
      err = await rename(
        target,
        `${base}/missing/off-tree/not-yet-existing/moved`,
      );
    } finally {
      spy.mockRestore();
    }

    expect(err).toBe(fault);
    // empty pages were created both below and above the off-tree page
    expect(emptyAncestorsAtFault).toEqual([
      `${base}/missing`,
      `${base}/missing/off-tree/not-yet-existing`,
    ]);
    expect(await snapshotTree()).toEqual(before);
  });

  it('restores the tree unchanged when detaching the page reports an error after it was applied', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const before = await snapshotTree();

    const fault = new Error('simulated lost acknowledgement of the detach');
    const realTakeOffFromTree = Page.takeOffFromTree.bind(Page);
    let detachedAtFault = false;
    const spy = vi
      .spyOn(Page, 'takeOffFromTree')
      .mockImplementationOnce(async (...args) => {
        await realTakeOffFromTree(...args);
        detachedAtFault = (await Page.findById(target._id))?.parent == null;
        throw fault;
      });
    let err: Error | null;
    try {
      err = await rename(target, `${base}/new-parent/moved`);
    } finally {
      spy.mockRestore();
    }

    expect(err).toBe(fault);
    // otherwise the detach never applied and there was nothing to restore
    expect(detachedAtFault).toBe(true);
    expect(await snapshotTree()).toEqual(before);
  });

  it('fails without a warning and leaves the tree unchanged when detaching the page fails before it applies', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const before = await snapshotTree();

    const fault = new Error('simulated failure of the detach');
    const takeOffSpy = vi
      .spyOn(Page, 'takeOffFromTree')
      .mockRejectedValueOnce(fault);
    const warnSpy = vi.spyOn(loggerFactory('growi:services:page'), 'warn');
    let err: Error | null;
    // read before mockRestore, which discards the recorded calls
    let warnings: string[] = [];
    try {
      err = await rename(target, `${base}/new-parent/moved`);
      warnings = warnSpy.mock.calls.map(([message]) => String(message));
    } finally {
      takeOffSpy.mockRestore();
      warnSpy.mockRestore();
    }

    expect(err).toBe(fault);
    expect(await snapshotTree()).toEqual(before);
    // nothing was detached, so nothing suggests that another writer moved the page
    expect(
      warnings.filter((w) => w.includes(`${base}/ex-parent/target`)),
    ).toEqual([]);
  });

  it('points the log at the new path, not at an off-tree page, when only removing the new ancestors fails', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const newPath = `${base}/new-parent/not-yet-existing/moved`;

    const cleanupFault = new Error(
      'simulated failure while removing the new ancestors',
    );
    let failedDeletes = 0;
    const failDelete = () => {
      failedDeletes += 1;
      throw cleanupFault;
    };
    const deleteManySpy = vi
      .spyOn(Page, 'deleteMany')
      .mockImplementation(failDelete);
    const deleteOneSpy = vi
      .spyOn(Page, 'deleteOne')
      .mockImplementation(failDelete);
    const errorSpy = vi.spyOn(loggerFactory('growi:services:page'), 'error');
    let result: Awaited<ReturnType<typeof renameWithFailingFinalWrite>>;
    // read before mockRestore, which discards the recorded calls
    let logged = '';
    try {
      result = await renameWithFailingFinalWrite(target, newPath, {
        applied: false,
      });
      logged = errorSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .join('\n');
    } finally {
      deleteManySpy.mockRestore();
      deleteOneSpy.mockRestore();
      errorSpy.mockRestore();
    }

    // otherwise the cleanup never failed and the assertions below prove nothing
    expect(failedDeletes).toBeGreaterThan(0);
    expect(result.err).toBe(result.fault);
    expect(await findPathAndParentPath(target._id)).toEqual({
      path: `${base}/ex-parent/target`,
      parentPath: `${base}/ex-parent`,
    });
    // the page is back on the tree; what may remain are the empty pages on the way to newPath
    expect(logged).toContain(
      `Reattached "${base}/ex-parent/target" after its failed rename`,
    );
    expect(logged).toContain(newPath);
  });

  it('warns that the page may have moved without its children when undoing the failed rename also fails', async () => {
    await create(base, 'base body');
    await create(`${base}/ex-parent`, 'body');
    await create(`${base}/new-parent`, 'body');
    const target = await create(`${base}/ex-parent/target`, 'body');
    const child = await create(`${base}/ex-parent/target/child`, 'body');
    const newPath = `${base}/new-parent/moved`;

    // the connection stays down: the write that undoes the rename fails too
    const connectionFault = new Error('simulated connection loss');
    const originalUpdateOne = Page.updateOne;
    const updateOneSpy = vi
      .spyOn(Page, 'updateOne')
      .mockImplementation(function (this: PageModel, ...args) {
        return originalUpdateOne.apply(this, args).error(connectionFault);
      });
    const errorSpy = vi.spyOn(loggerFactory('growi:services:page'), 'error');
    let result: Awaited<ReturnType<typeof renameWithFailingFinalWrite>>;
    // read before mockRestore, which discards the recorded calls
    let logged = '';
    try {
      result = await renameWithFailingFinalWrite(target, newPath, {
        applied: true,
      });
      logged = errorSpy.mock.calls
        .map((args) => args.map(String).join(' '))
        .join('\n');
    } finally {
      updateOneSpy.mockRestore();
      errorSpy.mockRestore();
    }

    // otherwise the final write never committed and the warning below would not apply
    expect(result.faultFired).toBe(true);
    expect(result.err).toBe(result.fault);
    // the page did move but its child stayed behind; only the log can tell an operator
    expect((await Page.findById(target._id))?.path).toBe(newPath);
    expect(await findPathAndParentPath(child._id)).toEqual({
      path: `${base}/ex-parent/target/child`,
      parentPath: newPath,
    });
    expect(logged).toContain(
      `at the new path with its descendants left at the original path`,
    );
    expect(logged).toContain(newPath);
  });
});
