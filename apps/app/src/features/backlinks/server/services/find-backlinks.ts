import type { IUser } from '@growi/core';
import type { Query, Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { PageQueryBuilder } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { IBacklink } from '../../interfaces/backlink';

// Intentionally unbounded: B2.1 measures this path against 100k pages with a
// 5,000-inbound hub at a median 29 ms (120 ms at 20,000 inbound), both plans
// index-backed, so no result cap or extra index is warranted yet. Re-measure with
// page-link-read-perf.integ.ts before adding either. Figures are devcontainer numbers
// re-taken after the Prisma migration — don't read a trend across environments.
type BacklinkSource = {
  _id: Types.ObjectId;
  path: string;
};

/**
 * The subset of `sourceIds` that `user` may read, as an **unexecuted** query.
 *
 * Unexecuted so a caller can either run it or explain() it. That is what lets the B2.1
 * benchmark (page-link-read-perf.integ.ts) time this half of the read path and assert
 * its plan is index-backed against the query production really issues: a copy of the
 * construction would drift silently, leaving the benchmark's sub-step breakdown and its
 * no-COLLSCAN guarantee describing a query that no longer exists.
 */
export const buildVisibleSourcesQuery = async (
  sourceIds: Types.ObjectId[],
  user: IUser | null,
  // Wrapped in an object rather than returned bare: a mongoose Query is itself a
  // thenable, so `await` on a Promise<Query> chains into it and resolves to the
  // executed result — which would defeat the whole point of handing back an
  // unexecuted query. The wrapper is not thenable, so it survives the await.
): Promise<{ query: Query<BacklinkSource[], PageDocument> }> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const builder = new PageQueryBuilder(Page.find({ _id: { $in: sourceIds } }));

  await builder.addViewerCondition(user);
  builder.addConditionToExcludeTrashed();

  return { query: builder.query.select('_id path') };
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
  const backlinkIds = await prisma.pagelinks.findBacklinkSources(toPageId);

  const { query } = await buildVisibleSourcesQuery(backlinkIds, user);
  const pages: BacklinkSource[] = await query.lean().exec();

  return pages.map((page) => ({
    pageId: page._id.toString(),
    path: page.path,
  }));
};
