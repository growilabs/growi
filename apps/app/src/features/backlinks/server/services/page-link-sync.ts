import type { Types } from 'mongoose';

import PageRedirect from '~/server/models/page-redirect';

import type { IPageLink } from '../../interfaces/page-link';
import PageLink from '../models/page-link';
import {
  REDIRECT_CHAIN_MAX_DEPTH,
  resolveToPages,
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

  await PageLink.replaceOutboundLinks(fromPageId, linksExceptSelf);
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
  const redirectingPaths = await PageRedirect.retrieveFromPathsRedirectingTo(
    toPath,
    REDIRECT_CHAIN_MAX_DEPTH,
  );
  const paths = [...new Set([toPath, ...redirectingPaths])];

  const resolved = await resolveToPages(paths);

  await Promise.all(
    paths.map((path) =>
      PageLink.repointInboundLinks(path, resolved.get(path) ?? null),
    ),
  );
};
