/**
 * Integration tests for deleteExpiredWipPageBySystem.
 *
 * Contract under test (observable state + boundary calls, not internals):
 *  - an expired WIP leaf is removed and its ancestors are decremented exactly once;
 *  - the claim is exclusive: concurrent sweeps delete once and decrement once;
 *  - a page that stopped being eligible between the sweep query and the claim
 *    (published, or given a child) is left alone — this is the data-loss guard;
 *  - the returned summary reports what happened.
 *
 * `IPageService` is mocked at the boundary (that IS the observable effect of the
 * delete for our purposes), while the Page collection is real so the atomic claim
 * is exercised against MongoDB rather than simulated.
 */
import type EventEmitter from 'node:events';
import type { IPage } from '@growi/core';
import mongoose from 'mongoose';
import { vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { getPageSchema } from '~/server/models/obsolete-page';
import { configManager } from '~/server/service/config-manager';

import type { PageModel } from '../../models/page';
import pageModel from '../../models/page';
import { deleteExpiredWipPageBySystem } from './delete-expired-wip-page-by-system';
import type { IPageService } from './page-service';

describe('deleteExpiredWipPageBySystem', () => {
  let Page: PageModel;

  const parentId = new mongoose.Types.ObjectId();
  const base = '/test-delete-expired-wip';

  const past = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 60 * 60_000);

  let mockUpdateDescendantCountOfAncestors: ReturnType<typeof vi.fn>;
  let mockDeleteCompletelyOperation: ReturnType<typeof vi.fn>;
  let mockPageEvent: EventEmitter;
  let pageService: IPageService;

  beforeAll(async () => {
    getPageSchema(null);
    pageModel(null);
    Page = mongoose.model<IPage, PageModel>('Page');

    await configManager.loadConfigs();
    await configManager.updateConfig('app:isV5Compatible', true);
  });

  beforeEach(async () => {
    mockUpdateDescendantCountOfAncestors = vi.fn().mockResolvedValue(undefined);
    mockDeleteCompletelyOperation = vi.fn().mockResolvedValue(undefined);
    mockPageEvent = mock<EventEmitter>();
    pageService = mock<IPageService>({
      updateDescendantCountOfAncestors: mockUpdateDescendantCountOfAncestors,
      deleteCompletelyOperation: mockDeleteCompletelyOperation,
      getEventEmitter: () => mockPageEvent,
    });

    // A real (non-empty) parent so the page is treated as v5-migrated.
    await Page.create({
      _id: parentId,
      path: base,
      grant: Page.GRANT_PUBLIC,
      parent: new mongoose.Types.ObjectId(),
      isEmpty: false,
      descendantCount: 1,
    });
  });

  afterEach(async () => {
    await Page.deleteMany({ path: new RegExp(`^${base}`) });
    await Page.deleteMany({ _id: parentId });
  });

  const createWipPage = async (
    path: string,
    wipExpiredAt: Date | undefined,
    descendantCount = 0,
  ) =>
    Page.create({
      path,
      grant: Page.GRANT_PUBLIC,
      parent: parentId,
      isEmpty: false,
      wip: true,
      wipExpiredAt,
      descendantCount,
    });

  it('deletes an expired WIP leaf and decrements its ancestors exactly once', async () => {
    const page = await createWipPage(`${base}/expired`, past());

    const summary = await deleteExpiredWipPageBySystem([page], pageService);

    expect(await Page.findById(page._id)).toBeNull();
    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledTimes(1);
    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledWith(
      parentId,
      -1, // leaf: -(descendantCount + 1)
      true,
    );
    // A system operation has no operator, so the actor must be an explicit null.
    expect(mockDeleteCompletelyOperation).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Array),
      null,
    );
    expect(mockPageEvent.emit).toHaveBeenCalled();
    expect(summary).toStrictEqual({
      deleted: 1,
      skippedNonLeaf: 0,
      skippedNotClaimed: 0,
      failed: 0,
    });
  });

  it('claims exclusively: concurrent sweeps delete once and decrement once', async () => {
    // The regression this guards: without the atomic claim both instances would
    // run the ancestor $inc, permanently double-decrementing descendantCount.
    const page = await createWipPage(`${base}/contended`, past());

    const [a, b] = await Promise.all([
      deleteExpiredWipPageBySystem([page], pageService),
      deleteExpiredWipPageBySystem([page], pageService),
    ]);

    expect(await Page.findById(page._id)).toBeNull();
    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledTimes(1);
    // exactly one sweep won the claim; the other skipped
    expect(a.deleted + b.deleted).toBe(1);
    expect(a.skippedNotClaimed + b.skippedNotClaimed).toBe(1);
  });

  it('leaves a page that was published between the sweep and the claim', async () => {
    // The sweep read the page while it was still expired WIP; the user published
    // it moments later. Deleting it from the stale in-memory copy would be data loss.
    const page = await createWipPage(`${base}/published-midway`, past());
    await Page.updateOne(
      { _id: page._id },
      { $unset: { wip: true, wipExpiredAt: true } },
    );

    const summary = await deleteExpiredWipPageBySystem([page], pageService);

    expect(await Page.findById(page._id)).not.toBeNull();
    expect(mockUpdateDescendantCountOfAncestors).not.toHaveBeenCalled();
    expect(summary.skippedNotClaimed).toBe(1);
    expect(summary.deleted).toBe(0);
  });

  it('leaves a page whose expiry was pushed into the future', async () => {
    const page = await createWipPage(`${base}/not-yet`, past());
    await Page.updateOne(
      { _id: page._id },
      { $set: { wipExpiredAt: future() } },
    );

    const summary = await deleteExpiredWipPageBySystem([page], pageService);

    expect(await Page.findById(page._id)).not.toBeNull();
    expect(summary.skippedNotClaimed).toBe(1);
  });

  it('skips a non-leaf page instead of orphaning its descendants', async () => {
    const page = await createWipPage(`${base}/has-children`, past(), 2);

    const summary = await deleteExpiredWipPageBySystem([page], pageService);

    expect(await Page.findById(page._id)).not.toBeNull();
    expect(mockUpdateDescendantCountOfAncestors).not.toHaveBeenCalled();
    expect(summary).toStrictEqual({
      deleted: 0,
      skippedNonLeaf: 1,
      skippedNotClaimed: 0,
      failed: 0,
    });
  });

  it('keeps sweeping after one page fails', async () => {
    // One bad page must not abort the run — the rest of the expired backlog
    // still has to be collected.
    const failing = await createWipPage(`${base}/fails`, past());
    const ok = await createWipPage(`${base}/succeeds`, past());

    mockDeleteCompletelyOperation
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);

    const summary = await deleteExpiredWipPageBySystem(
      [failing, ok],
      pageService,
    );

    expect(summary.failed).toBe(1);
    expect(summary.deleted).toBe(1);
  });
});
