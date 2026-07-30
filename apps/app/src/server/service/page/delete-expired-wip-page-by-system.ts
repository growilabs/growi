import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

import { deletePageCompletelyBySystem } from './delete-page-completely-by-system';
import type { IPageService } from './page-service';

const logger = loggerFactory('growi:services:page:delete-expired-wip');

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
  /** Claimed, but the deletion threw. The page is still there, minus its expiry. */
  failed: number;
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
          'It remains in place with its expiry withdrawn, so no later sweep will retry it.',
        err,
      );
    }
  }

  return { deleted, skippedNonLeaf, skippedNotClaimed, failed };
};
