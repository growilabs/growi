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

export const syncOutboundLinks = async (
  fromPageId: Types.ObjectId,
  resolvedRows: IPageLink[],
): Promise<void> => {
  const linksExceptSelf = dropSelfLinks(fromPageId, resolvedRows);

  await PageLink.replaceOutboundLinks(fromPageId, linksExceptSelf);
};
