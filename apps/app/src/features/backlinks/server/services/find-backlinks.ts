import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';

import type { IBacklink } from '../../interfaces/backlink';
import PageLink from '../models/page-link';

// Read-path scale for heavily-linked hub pages (bounding/index/interactive-time)
// is handled in B2.1; intentionally unbounded here.
type BacklinkSource = {
  _id: Types.ObjectId;
  path: string;
};

/**
 * List the pages linking to `toPageId` that `user` is allowed to read.
 *
 * The grant filter runs at read time rather than being baked into the stored
 * rows, so a grant change on a source page is reflected on the next read
 * without touching the index.
 */
export const findBacklinks = async (
  toPageId: Types.ObjectId,
  user: IUser | null,
): Promise<IBacklink[]> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const backlinkIds = await PageLink.findBacklinkSources(toPageId);

  const builder = new PageQueryBuilder(
    Page.find({ _id: { $in: backlinkIds } }),
  );

  await builder.addViewerCondition(user);
  builder.addConditionToExcludeTrashed();

  const pages: BacklinkSource[] = await builder.query
    .select('_id path')
    .lean()
    .exec();

  return pages.map((page) => ({
    pageId: page._id.toString(),
    path: page.path,
  }));
};
