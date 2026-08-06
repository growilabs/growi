import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';

import type { IBacklink } from '../../interfaces/backlink';
import PageLink from '../models/page-link';

// Intentionally unbounded: B2.1 measured this path against 100k pages with a
// 5,000-inbound hub at a median 128 ms (192 ms at 20,000 inbound; 164 ms with a cache
// 19x too small to hold the data), both plans index-backed, so no result cap or extra
// index is warranted yet. Re-measure with page-link-read-perf.integ.ts before adding either.
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
