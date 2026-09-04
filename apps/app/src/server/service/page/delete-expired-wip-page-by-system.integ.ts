/**
 * Integration tests for deleteExpiredWipPageBySystem.
 *
 * Contract under test (observable state + boundary calls, not internals):
 *  - an expired WIP leaf is handed to the complete-delete primitive and its
 *    ancestors are decremented, exactly once;
 *  - the claim is exclusive: concurrent sweeps act once;
 *  - a page that stopped being eligible between the sweep query and the claim
 *    (published, expiry pushed out, or given a child) is left alone — this is the
 *    data-loss guard;
 *  - a claimed page loses its expiry, so no sweep picks it up again;
 *  - a failed deletion leaves the page in place rather than half-deleted, expiry
 *    re-armed for a later sweep and ancestor counters untouched so the retry cannot
 *    double-decrement them — but not re-armed if the page has since changed;
 *  - the returned summary reports what happened.
 *
 * `IPageService` is mocked at the boundary — deleteCompletelyOperation IS the
 * observable deletion here — while the Page collection is real so the atomic claim
 * is exercised against MongoDB rather than simulated. Because that boundary is
 * mocked, the page document itself survives these tests; the row actually going
 * away is covered by wip-page-cleanup-cron.integ.ts against the real service.
 */
import type EventEmitter from 'node:events';
import type { IPage } from '@growi/core';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
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
    await Page.deleteMany({
      path: new RegExp(`^${escapeStringForMongoRegex(base)}`),
    });
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

    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledTimes(1);
    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledWith(
      parentId,
      -1, // leaf: -(descendantCount + 1)
      true,
    );
    // A system operation has no operator, so the actor must be an explicit null.
    expect(mockDeleteCompletelyOperation).toHaveBeenCalledWith(
      [page._id],
      [page.path],
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

  it('withdraws the expiry of a claimed page, so a later sweep does not act twice', async () => {
    // The page row is removed by deleteCompletelyOperation (mocked here), so what
    // makes the claim safe to re-run is the expiry being gone.
    const page = await createWipPage(`${base}/claimed-once`, past());

    await deleteExpiredWipPageBySystem([page], pageService);
    expect((await Page.findById(page._id))?.wipExpiredAt).toBeUndefined();

    const second = await deleteExpiredWipPageBySystem([page], pageService);

    expect(mockDeleteCompletelyOperation).toHaveBeenCalledTimes(1);
    expect(second.deleted).toBe(0);
    expect(second.skippedNotClaimed).toBe(1);
  });

  it('claims exclusively: concurrent sweeps act once', async () => {
    // The regression this guards: without the atomic claim both instances would
    // run the ancestor $inc, permanently double-decrementing descendantCount.
    const page = await createWipPage(`${base}/contended`, past());

    const [a, b] = await Promise.all([
      deleteExpiredWipPageBySystem([page], pageService),
      deleteExpiredWipPageBySystem([page], pageService),
    ]);

    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledTimes(1);
    expect(mockDeleteCompletelyOperation).toHaveBeenCalledTimes(1);
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

  it('skips a page that gained a child after the sweep read it', async () => {
    // descendantCount is updated in a separate operation from the child insert, so
    // a page that just gained a child still passes the pre-filter and the claim.
    // Only the parent-link check catches it — without it the child is orphaned.
    const page = await createWipPage(`${base}/gained-child`, past());
    await Page.create({
      path: `${base}/gained-child/kid`,
      grant: Page.GRANT_PUBLIC,
      parent: page._id,
      isEmpty: false,
      descendantCount: 0,
    });

    const summary = await deleteExpiredWipPageBySystem([page], pageService);

    expect(await Page.findById(page._id)).not.toBeNull();
    expect(mockDeleteCompletelyOperation).not.toHaveBeenCalled();
    expect(summary.skippedNonLeaf).toBe(1);
    expect(summary.deleted).toBe(0);
  });

  it('keeps sweeping after one page fails, leaving the failed page intact', async () => {
    // One bad page must not abort the run — the rest of the expired backlog still
    // has to be collected. And the failed page must survive whole: the claim is
    // non-destructive precisely so a mid-deletion failure cannot leave the page
    // gone while its revisions and attachments linger.
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
    expect(await Page.findById(failing._id)).not.toBeNull();
    // The failed page must not have moved them, or its retry decrements twice.
    expect(mockUpdateDescendantCountOfAncestors).toHaveBeenCalledTimes(1);
  });

  it('re-arms the expiry of a failed page, so a later sweep retries it', async () => {
    // The sweep selects on wipExpiredAt, so leaving the claim's withdrawal in place
    // drops the page out of every future sweep — a transient error costs it its
    // cleanup permanently.
    const page = await createWipPage(`${base}/fails-then-retried`, past());
    mockDeleteCompletelyOperation.mockRejectedValueOnce(new Error('boom'));

    await deleteExpiredWipPageBySystem([page], pageService);

    const rearmed = (await Page.findById(page._id))?.wipExpiredAt;
    expect(rearmed).toBeInstanceOf(Date);
    // Future, so nothing re-claims it on the spot...
    expect((rearmed as Date).getTime()).toBeGreaterThan(Date.now());
    // ...but inside one cron interval, or "retry later" is really "abandon".
    expect((rearmed as Date).getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60 * 1000,
    );

    // ...and the retry actually succeeds once the page is due again.
    await Page.updateOne({ _id: page._id }, { $set: { wipExpiredAt: past() } });
    const retry = await deleteExpiredWipPageBySystem([page], pageService);

    expect(retry.deleted).toBe(1);
    expect(mockDeleteCompletelyOperation).toHaveBeenCalledTimes(2);
  });

  it('does not re-arm a page that was published while the deletion was failing', async () => {
    // Re-arming blindly hands an expiry back to a page the user has since
    // published, and the next sweep deletes it.
    const page = await createWipPage(`${base}/published-while-failing`, past());
    mockDeleteCompletelyOperation.mockImplementationOnce(async () => {
      await Page.updateOne({ _id: page._id }, { $unset: { wip: true } });
      throw new Error('boom');
    });

    const summary = await deleteExpiredWipPageBySystem([page], pageService);

    expect(summary.failed).toBe(1);
    const after = await Page.findById(page._id);
    expect(after).not.toBeNull();
    expect(after?.wipExpiredAt).toBeUndefined();
  });
});
