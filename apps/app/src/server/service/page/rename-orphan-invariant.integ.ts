/**
 * Integration test for issue #9755: a rename that fails must not leave the page
 * detached from the page tree.
 *
 * WHY this needs guarding: renameMainOperation performs
 *   1. takeOffFromTree(page._id)   -- commits parent: null
 *   2. resolve/create the new parent  -- can throw
 *   3. findByIdAndUpdate(new path + new parent)
 * with no mongo session and no rollback. When step 2 throws, step 1 stays committed
 * and the page is stranded off-tree at its OLD path: invisible in the sidebar (which
 * walks `parent`) and missed by a `pages/list` query rooted at the intended
 * destination (which is a path-prefix match).
 *
 * A page in the trash is the reachable trigger: deleteNonEmptyTarget sets
 * `status: deleted` and `parent: null` while leaving `grant` public. That state falls
 * into a gap between two filters that disagree:
 *   - createEmptyPagesByPaths' "already exists" filter matches on
 *     `{$or: [{grant: PUBLIC}, {parent: {$ne: null}}, {path: '/'}]}` -- no status
 *     check, so it treats the trashed page as existing and back-fills nothing.
 *   - connectPageTree's addConditionToFilterByApplicableAncestors requires
 *     `status: STATUS_PUBLISHED` in every clause, so it never re-parents it.
 * getParentAndFillAncestorsByUser is then left with no on-tree parent to return and
 * throws 'Failed to find the created parent by getParentAndFillAncestorsByUser'.
 *
 * The assertion is on observable page state after an ordinary rename call, not on the
 * mechanism, so moving where the invariant is enforced will not break it.
 */

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

  // renameMainOperation fires renameSubOperation WITHOUT awaiting it, so a test that
  // asserts straight after renamePage() races it. Capture and run it explicitly.
  const rename = async (page, newPagePath: string, options = {}) => {
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
    // the trash copy lives under /trash<base>, so both prefixes need clearing
    await Page.deleteMany({
      path: { $in: [new RegExp(`^${base}`), new RegExp(`^/trash${base}`)] },
    });
  });

  it('leaves the page on the tree when the destination parent is a trashed page', async () => {
    await create(base, 'base body');
    const victim = await create(`${base}/deleted-later`, 'body');
    const target = await create(`${base}/target`, 'body');

    // real deletion -> path becomes /trash<path>, status deleted, parent null,
    // grant left public: the exact state the two filters disagree about
    await crowi.pageService.deletePage(victim, user, {}, false, {
      ip: '::ffff:127.0.0.1',
      endpoint: '/_api/v3/pages/delete',
    });
    const trashed = await Page.findById(victim._id);
    expect(trashed?.parent).toBeNull();
    expect(trashed?.status).toBe('deleted');

    const err = await rename(target, `${trashed?.path}/moved`);

    const after = await Page.findById(target._id);

    // The rename is allowed to fail. What it must not do is strand the page:
    // whether it moved or stayed put, it must still be reachable from the tree.
    expect(after).not.toBeNull();
    expect(
      after?.parent,
      `rename failed with "${err?.message}" and left the page off-tree at ` +
        `"${after?.path}" (parent: null) — it is now invisible in the page tree`,
    ).not.toBeNull();
  });
});
