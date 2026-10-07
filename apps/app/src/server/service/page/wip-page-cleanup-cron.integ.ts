/**
 * Integration test for the WIP page cleanup cron.
 *
 * Contract under test: one run collects the WIP pages whose expiry has passed and
 * leaves everything else alone. The selection criteria are the point — a regression
 * here either deletes pages it shouldn't or silently stops collecting.
 *
 * Math.random is pinned to 0 so the start-up jitter is a no-op; the jitter itself
 * is a load-spreading measure with no bearing on what gets deleted.
 */
import type { IPage } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import mongoose from 'mongoose';
import { vi } from 'vitest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageModel } from '~/server/models/page';

import { WipPageCleanupCronService } from './wip-page-cleanup-cron';

describe('WipPageCleanupCronService (integration)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let cron: WipPageCleanupCronService;

  const base = '/test-wip-cleanup-cron';
  const parentId = new mongoose.Types.ObjectId();

  const past = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 60 * 60_000);

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');
    cron = new WipPageCleanupCronService(crowi);

    const root = await Page.findOne({ path: '/' });
    if (root == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
  });

  beforeEach(async () => {
    // Skip the jitter: randomSleep(max) sleeps for Math.random() * max.
    vi.spyOn(Math, 'random').mockReturnValue(0);

    await Page.create({
      _id: parentId,
      path: base,
      grant: Page.GRANT_PUBLIC,
      parent: (await Page.findOne({ path: '/' }))?._id,
      isEmpty: false,
      descendantCount: 0,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Page.deleteMany({
      path: new RegExp(`^${escapeStringForMongoRegex(base)}`),
    });
    await Page.deleteMany({ _id: parentId });
  });

  // Partial<IPage>, not Partial<Record<string, unknown>>: these fixtures exist to
  // pin selection criteria, so a typo in a field name must not compile.
  const createPage = async (path: string, fields: Partial<IPage>) =>
    Page.create({
      path,
      grant: Page.GRANT_PUBLIC,
      parent: parentId,
      isEmpty: false,
      descendantCount: 0,
      ...fields,
    });

  it('deletes expired WIP pages and leaves everything else', async () => {
    const expired = await createPage(`${base}/expired`, {
      wip: true,
      wipExpiredAt: past(),
    });
    const notYetExpired = await createPage(`${base}/not-yet`, {
      wip: true,
      wipExpiredAt: future(),
    });
    // published: wipExpiredAt cleared, must never be collected
    const published = await createPage(`${base}/published`, {});
    // WIP with no expiry at all (makeWip's disableTtl path)
    const wipNoExpiry = await createPage(`${base}/wip-forever`, { wip: true });

    await cron.executeJob();

    expect(await Page.findById(expired._id)).toBeNull();
    expect(await Page.findById(notYetExpired._id)).not.toBeNull();
    expect(await Page.findById(published._id)).not.toBeNull();
    expect(await Page.findById(wipNoExpiry._id)).not.toBeNull();
  });

  it('does not delete an expired WIP page that has descendants', async () => {
    // Deleting it would orphan the child. The invariant maintained on write
    // should prevent this state, so this is the defence-in-depth path.
    const withChild = await createPage(`${base}/has-child`, {
      wip: true,
      wipExpiredAt: past(),
      descendantCount: 1,
    });
    await createPage(`${base}/has-child/kid`, { parent: withChild._id });

    await cron.executeJob();

    expect(await Page.findById(withChild._id)).not.toBeNull();
  });

  it('collects nothing while GROWI is in maintenance mode', async () => {
    // Maintenance mode is when an operator runs the page tree repair, which
    // recounts descendantCount across the collection. A sweep deleting pages
    // underneath it races that recount, so the sweep stands down.
    const expired = await createPage(`${base}/expired-in-maintenance`, {
      wip: true,
      wipExpiredAt: past(),
    });
    await crowi.appService.startMaintenanceMode();

    try {
      await cron.executeJob();
      expect(await Page.findById(expired._id)).not.toBeNull();
    } finally {
      await crowi.appService.endMaintenanceMode();
    }

    // ...and it is only deferred: the next run outside maintenance mode collects it.
    await cron.executeJob();
    expect(await Page.findById(expired._id)).toBeNull();
  });

  it('is safe to run twice (nothing left to collect on the second pass)', async () => {
    const expired = await createPage(`${base}/expired-twice`, {
      wip: true,
      wipExpiredAt: past(),
    });

    await cron.executeJob();
    await expect(cron.executeJob()).resolves.not.toThrow();

    expect(await Page.findById(expired._id)).toBeNull();
  });
});
