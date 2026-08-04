import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { deletePageCompletelyBySystem } from './delete-page-completely-by-system';
import type { IPageService } from './page-service';

const logger = loggerFactory('growi:services:page:delete-expired-wip');

/**
 * How long a page whose deletion threw waits before a sweep may claim it again.
 * Shorter than any sensible cron schedule, so in practice it means "retry on the
 * next run" while still keeping a single run from re-claiming the same page.
 */
const FAILED_DELETION_RETRY_BACKOFF_MS = 60 * 60 * 1000;

/**
 * The minimum a candidate must carry: the sweep only needs to identify the page
 * and pre-filter it. Everything the deletion itself needs comes from the document
 * the claim returns, so the caller is free to stream lean projections rather than
 * hydrated documents.
 */
export type ExpiredWipPageCandidate = {
  _id: Types.ObjectId;
  path: string;
  descendantCount: number;
};

export type DeleteExpiredWipPageSummary = {
  deleted: number;
  /** Has descendants, so deleting it would orphan them. Left alive, no expiry. */
  skippedNonLeaf: number;
  /** Claim lost to another instance, or the page stopped being eligible. */
  skippedNotClaimed: number;
  /** Claimed, but the deletion threw. The page is still there, expiry re-armed. */
  failed: number;
};

/**
 * Puts back the expiry that the claim withdrew, after the deletion failed.
 *
 * Without this the failure is permanent and silent: the sweep selects on
 * `wipExpiredAt`, so a page left without one is never looked at again — it stays
 * WIP forever while the operator sees nothing but one log line. Re-arming makes a
 * transient failure (a MongoDB hiccup, search index or attachment store being
 * down) cost a retry instead of the whole feature for that page.
 *
 * The filter is what keeps this from becoming its own data-loss path: it re-arms
 * only a page that is still WIP and still has no expiry, i.e. still exactly what
 * the claim left behind. If the page was published, re-claimed, or already removed
 * meanwhile, it matches nothing and the state stands.
 *
 * A failure here is swallowed on purpose — the sweep is already in its error path,
 * and losing the remaining backlog to a secondary error would be the worse outcome.
 */
const rearmExpiry = async (
  Page: PageModel,
  page: ExpiredWipPageCandidate,
): Promise<void> => {
  const retryAt = new Date(Date.now() + FAILED_DELETION_RETRY_BACKOFF_MS);
  try {
    const res = await Page.updateOne(
      { _id: page._id, wip: true, wipExpiredAt: { $exists: false } },
      { $set: { wipExpiredAt: retryAt } },
    );
    if (res.modifiedCount === 0) {
      logger.warn(
        `Did not re-arm the expiry of ${page.path}: it is no longer the WIP page the claim left behind (published, re-claimed or already removed).`,
      );
    }
  } catch (err) {
    logger.error(
      `Failed to re-arm the expiry of ${page.path} (id=${page._id.toString()}). ` +
        'No later sweep will retry this page until it is made WIP again.',
      err,
    );
  }
};

export const deleteExpiredWipPageBySystem = async (
  pages:
    | AsyncIterable<ExpiredWipPageCandidate>
    | Iterable<ExpiredWipPageCandidate>,
  pageService: IPageService,
): Promise<DeleteExpiredWipPageSummary> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');

  let deleted = 0;
  let skippedNonLeaf = 0;
  let skippedNotClaimed = 0;
  let failed = 0;

  for await (const page of pages) {
    if (page.descendantCount !== 0) {
      skippedNonLeaf++;
      logger.warn(
        `Skipping non-leaf expired WIP page: ${page.path} (descendantCount=${page.descendantCount})`,
      );
      continue;
    }

    // The claim withdraws the expiry rather than deleting the row. The filter
    // requires wipExpiredAt to still be set, so exactly one instance wins, and
    // the page it wins ends up in the state makeWip(disableTtl = true) would have
    // produced — no longer selectable by any sweep, but intact.
    //
    // Deleting the row here instead would make every later failure unrecoverable:
    // the page would be gone while its revisions, attachments and search-index
    // entries survived, with nothing left in the collection to select it for a
    // retry. Keeping the row means the page document is removed only by
    // deleteCompletelyOperation, together with everything that belongs to it.
    const claimed = await Page.findOneAndUpdate(
      {
        _id: page._id,
        wip: true,
        wipExpiredAt: { $lte: new Date() },
        descendantCount: 0,
      },
      { $unset: { wipExpiredAt: true } },
      { new: true },
    );
    if (claimed == null) {
      skippedNotClaimed++;
      continue;
    }

    // Re-check by parent link, not by descendantCount: page creation inserts the
    // child first and updates its ancestors' counts (and clears their expiry) in a
    // separate operation, so a page that has just gained a child still reads
    // descendantCount 0 for a moment. Aborting here leaves the page alive without
    // an expiry, which is exactly the state the invariant wants for it.
    //
    // This narrows that window rather than closing it — a child inserted after
    // this check but before the deletion completes is still orphaned (its parent
    // link dangles, so it drops out of the page tree). Closing it properly needs
    // the creation path to reject a parent that is mid-deletion; until then the
    // remedy is normalizeAllPublicPages (Admin > App Settings > V5 page migration),
    // since repairPageTree recounts and prunes but never re-parents.
    const hasChildren = (await Page.exists({ parent: page._id })) != null;
    if (hasChildren) {
      skippedNonLeaf++;
      logger.warn(
        `Skipping expired WIP page that gained a child after the sweep: ${page.path}`,
      );
      continue;
    }

    try {
      await deletePageCompletelyBySystem(claimed, pageService);
      deleted++;
    } catch (err) {
      failed++;
      logger.error(
        `Failed to delete expired WIP page: ${page.path} (id=${page._id.toString()}). ` +
          'Its expiry is being re-armed so a later sweep retries it.',
        err,
      );
      await rearmExpiry(Page, page);
    }
  }

  return { deleted, skippedNonLeaf, skippedNotClaimed, failed };
};
