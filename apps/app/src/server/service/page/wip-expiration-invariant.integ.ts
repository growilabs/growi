/**
 * Integration test for the invariant: a WIP page that gains a descendant must stop
 * auto-expiring.
 *
 * WHY this needs guarding: `makeWip()` withholds the expiry from a page that
 * already has children (`disableTtl`), but that check runs once, at creation. Without
 * maintaining it afterwards, a page created as a childless WIP keeps a live
 * `wipExpiredAt`; if a child is added later, the cleanup cron finds an expired WIP
 * page with descendants and can only skip it forever (or, before the leaf guard,
 * orphan the child).
 *
 * The assertions are on observable page state after ordinary create/rename calls —
 * not on the mechanism — so relocating where the invariant is enforced will not
 * break them.
 */

import type { IPage } from '@growi/core';
import type { Model } from 'mongoose';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';

describe('WIP expiry is cleared when a page gains a descendant', () => {
  let crowi: Crowi;
  let Page: PageModel;
  // biome-ignore lint/suspicious/noExplicitAny: the User model is an untyped JS module
  let User: Model<any>;
  // ~/server/models/user.js is untyped and not importable under vitest, so there is
  // no User document type to annotate with. The sibling v5 page integ tests carry
  // the same limitation.
  // biome-ignore lint/suspicious/noExplicitAny: no User document type is available
  let user: any;

  const base = '/test-wip-invariant';

  // Mirrors the helper used by the v5 page integ tests: create() defers the rest of
  // the work to createSubOperation, which the caller must then run.
  const create = async (path: string, body: string, options = {}) => {
    const mockedCreateSubOperation = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockReturnValue(Promise.resolve());

    const createdPage = await crowi.pageService.create(
      path,
      body,
      user,
      options,
    );

    const args = mockedCreateSubOperation.mock.calls[0];
    mockedCreateSubOperation.mockRestore();
    await crowi.pageService.createSubOperation(
      ...(args as Parameters<typeof crowi.pageService.createSubOperation>),
    );

    return createdPage;
  };

  // renameMainOperation fires renameSubOperation WITHOUT awaiting it, and the
  // ancestor descendantCount update lives in the sub-operation — so a test that
  // asserts straight after renamePage() races it. Capture and run it explicitly.
  const rename = async (page: IPage, newPagePath: string, options = {}) => {
    const mockedRenameSubOperation = vi
      .spyOn(crowi.pageService, 'renameSubOperation')
      .mockReturnValue(Promise.resolve());

    const renamedPage = await crowi.pageService.renamePage(
      page,
      newPagePath,
      user,
      options,
      { ip: '::ffff:127.0.0.1', endpoint: '/_api/v3/pages/rename' },
    );

    const args = mockedRenameSubOperation.mock.calls[0];
    mockedRenameSubOperation.mockRestore();
    if (args != null) {
      await crowi.pageService.renameSubOperation(
        ...(args as Parameters<typeof crowi.pageService.renameSubOperation>),
      );
    }

    return renamedPage;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    Page = mongoose.model<PageDocument, PageModel>('Page');
    User = mongoose.model('User');

    if ((await Page.findOne({ path: '/' })) == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }

    user = await User.findOne({ username: 'wipInvariantUser' });
    if (user == null) {
      user = await User.create({
        name: 'wipInvariantUser',
        username: 'wipInvariantUser',
        email: 'wip-invariant@example.com',
      });
    }
  });

  afterEach(async () => {
    await Page.deleteMany({ path: new RegExp(`^${base}`) });
  });

  it('sets an expiry on a WIP page created without children', async () => {
    // Baseline: without this the later assertions could pass vacuously.
    const page = await create(`${base}/lonely`, 'body', { wip: true });

    const stored = await Page.findById(page._id);
    expect(stored?.wip).toBe(true);
    expect(stored?.wipExpiredAt).toBeInstanceOf(Date);
  });

  it('clears the expiry when a child page is created underneath', async () => {
    const parent = await create(`${base}/gains-child`, 'body', { wip: true });
    expect((await Page.findById(parent._id))?.wipExpiredAt).toBeInstanceOf(
      Date,
    );

    await create(`${base}/gains-child/kid`, 'body');

    const stored = await Page.findById(parent._id);
    expect(stored?.wipExpiredAt).toBeUndefined();
    // still WIP — only the auto-expiry is withdrawn, exactly as makeWip's
    // disableTtl path would have produced at creation time
    expect(stored?.wip).toBe(true);
  });

  it('clears the expiry when an existing page is renamed underneath', async () => {
    const parent = await create(`${base}/gains-by-rename`, 'body', {
      wip: true,
    });
    const other = await create(`${base}/elsewhere`, 'body');
    expect((await Page.findById(parent._id))?.wipExpiredAt).toBeInstanceOf(
      Date,
    );

    await rename(other, `${base}/gains-by-rename/moved`);

    const stored = await Page.findById(parent._id);
    expect(stored?.wipExpiredAt).toBeUndefined();
  });
});
