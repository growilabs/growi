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
 * Entry point for keeping a page's outbound links in sync (create/update event
 * handlers call this). Drops self-links, then delegates the write to the
 * `PageLink.replaceOutboundLinks` model primitive — always go through here so
 * self-links never get persisted.
 */
export const syncOutboundLinks = async (
  fromPageId: Types.ObjectId,
  resolvedRows: IPageLink[],
): Promise<void> => {
  const linksExceptSelf = dropSelfLinks(fromPageId, resolvedRows);

  await PageLink.replaceOutboundLinks(fromPageId, linksExceptSelf);
};

/**
 * Recompute the derived `toPage` cache of every row linking to `toPath`, except a
 * row whose own source is the resolved target — a page is never its own backlink.
 *
 * A row's cache is only written when its *source* page is saved, so it goes stale
 * when the occupancy of the target path changes underneath it: a page appears at a
 * path that resolved to nothing, or a new occupant takes over a path whose previous
 * one is still cached. A path resolving to nothing writes null — that is how a row
 * returns to broken.
 */
export const reResolveByToPath = async (toPath: string): Promise<void> => {
  // A row does not have to name the path to reach it: resolution follows the
  // redirect chain, so `/old` resolves here whenever `/old` redirects here. Those
  // rows go stale on the same event and nothing else revisits them. The reverse
  // walk only nominates candidates — `resolveToPages` decides where each one
  // actually lands, which for a longer chain may be somewhere else entirely.
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
