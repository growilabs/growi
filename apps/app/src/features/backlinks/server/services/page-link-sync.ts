import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import PageRedirect from '~/server/models/page-redirect';
import { prisma } from '~/utils/prisma';

import type { IPageLink } from '../../interfaces/page-link';
import {
  REDIRECT_CHAIN_MAX_DEPTH,
  resolveToPageIds,
} from './target-page-resolution';

export const dropSelfLinks = (
  fromPageId: Types.ObjectId,
  resolvedRows: IPageLink[],
): IPageLink[] => {
  return resolvedRows.filter(
    (row) => row.toPage == null || !row.toPage.equals(fromPageId),
  );
};

/**
 * OUTBOUND: rebuild the current page's own rows from a fresh scrape of its body
 * (see `handlePageUpsert`). Drops self-links, then replaces every existing row
 * for `fromPageId` via `PageLink.replaceOutboundLinks` — always go through here
 * so self-links never get persisted.
 */
export const syncOutboundLinks = async (
  fromPageId: Types.ObjectId,
  resolvedRows: IPageLink[],
): Promise<void> => {
  const linksExceptSelf = dropSelfLinks(fromPageId, resolvedRows);

  await prisma.pagelinks.replaceOutboundLinks(fromPageId, linksExceptSelf);
};

/**
 * INBOUND: refresh other pages' cached links that point at current page `toPath`.
 * A row's `toPage` cache is written only when its source page is
 * saved, so it goes stale when the target path's occupant changes instead —
 * this runs on the target side to catch that.
 *
 *   1. Find other paths that redirect into `toPath`.
 *   2. Add `toPath` itself, so a row naming it directly is covered too.
 *   3. Resolve each candidate id independently to its current occupant.
 *   4. Per candidate, bulk-repoint every `PageLink` row whose `toPath` matches
 *      that string (by text, not by source page). Unresolved writes null.
 */
export const reResolveByToPath = async (toPath: string): Promise<void> => {
  // A row does not have to name the path to reach it: resolution follows the
  // redirect chain, so `/old` resolves here whenever `/old` redirects here. Those
  // rows go stale on the same event and nothing else revisits them. The reverse
  // walk only nominates candidates — `resolveToPageIds` decides where each one
  // actually lands, which for a longer chain may be somewhere else entirely.
  const redirectingPaths = await PageRedirect.retrieveFromPathsRedirectingTo(
    toPath,
    REDIRECT_CHAIN_MAX_DEPTH,
  );
  const paths = [...new Set([toPath, ...redirectingPaths])];

  const resolved = await resolveToPageIds(paths);

  await Promise.all(
    paths.map((path) =>
      prisma.pagelinks.repointInboundLinks(path, resolved.get(path) ?? null),
    ),
  );
};

/**
 * DELETE: settle the rows of pages a delete-family event just removed, via `removeLinksForPages`.
 *
 * Existence decides, not `status`: a soft delete keeps the document, so a merely-trashed page is
 * found here and needs no write — its rows already derive as `trashed`.
 *
 * Call this after the delete has committed; before, a page being purged still reads as present.
 * Pass one event payload's ids — `removeLinksForPages` explains why the batch must not accumulate.
 */
export const reconcileDeletedPages = async (
  pageIds: Types.ObjectId[],
): Promise<void> => {
  if (pageIds.length === 0) {
    return;
  }

  const Page = mongoose.model<PageDocument, PageModel>('Page');

  const foundPages = await Page.find({ _id: { $in: pageIds } }).select('_id');
  const surviving = new Set(foundPages.map((page) => page._id.toString()));

  await prisma.pagelinks.removeLinksForPages(
    pageIds.filter((id) => !surviving.has(id.toString())),
  );
};
