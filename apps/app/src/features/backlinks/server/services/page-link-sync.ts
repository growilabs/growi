import type { Types } from 'mongoose';

import type { IPageLink } from '../../interfaces/page-link';
import PageLink from '../models/page-link';

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
