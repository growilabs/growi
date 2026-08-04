import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:page:repair-page-tree:remove-empty-leaf-hierarchies',
);

/**
 * Bounds every id array this module puts in a query, and every result set it holds
 * in memory. Without it a wiki with a large orphan backlog builds a `$in` big enough
 * to breach the 16 MB BSON document limit and fail the whole repair.
 */
const BATCH_SIZE = 1000;

/**
 * Backstops a data anomaly (e.g. a parent cycle) from spinning forever. Passes after
 * the first only re-examine the parents of what was just deleted, so this caps the
 * depth of the cascade, not how many pages can be removed.
 */
const MAX_PASSES = 100;

/** The scan's snapshot of a candidate: enough to delete it and climb one level. */
type EmptyLeafCandidate = {
  _id: mongoose.Types.ObjectId;
  parent?: mongoose.Types.ObjectId | null;
};

type SweepResult = {
  removed: number;
  parentIds: mongoose.Types.ObjectId[];
};

/**
 * Deletes the candidates that are still orphaned placeholders, and reports the
 * parents of the ones it removed so the caller can walk one level up.
 *
 * Candidates are a *snapshot*: the caller found them earlier, and this runs against
 * a live site (the admin endpoint gates on maintenance mode, the service itself does
 * not). Both conditions are therefore re-checked at delete time rather than trusted:
 *
 *  - childlessness, because a page created under a candidate in the meantime would
 *    be orphaned by removing its parent;
 *  - `isEmpty`, because a placeholder can be filled in by an ordinary page creation
 *    (preparePageDocumentToCreate reuses empty pages), turning it into real content.
 *
 * Exported for the co-located test, which passes a deliberately stale snapshot to
 * reproduce both races without having to interleave anything.
 */
export const deleteStillOrphanedEmptyPages = async (
  candidates: EmptyLeafCandidate[],
): Promise<SweepResult> => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  if (candidates.length === 0) {
    return { removed: 0, parentIds: [] };
  }

  const ids = candidates.map((c) => c._id);
  const idsThatGainedChildren = new Set(
    (await Page.distinct('parent', { parent: { $in: ids } })).map(String),
  );
  const stillChildless = candidates.filter(
    (c) => !idsThatGainedChildren.has(String(c._id)),
  );
  if (stillChildless.length === 0) {
    return { removed: 0, parentIds: [] };
  }

  const res = await Page.deleteMany({
    _id: { $in: stillChildless.map((c) => c._id) },
    isEmpty: true,
  });

  // Parents of everything that passed the childless check. A candidate the isEmpty
  // re-assert rejected contributes its parent too, which costs one wasted
  // re-examination — cheaper than reading back the ids to find out which went.
  const parentIds = stillChildless
    .map((c) => c.parent)
    .filter((id): id is mongoose.Types.ObjectId => id != null);

  return { removed: res.deletedCount ?? 0, parentIds };
};

/**
 * Scans the whole collection for childless empty pages, one bounded batch at a time.
 *
 * `$skip` advances past candidates the delete step declined, so a batch that is
 * rejected in full cannot be handed back forever.
 */
const sweepAllEmptyLeaves = async (): Promise<SweepResult> => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  let removed = 0;
  const parentIds: mongoose.Types.ObjectId[] = [];
  let skip = 0;

  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: each batch must observe the previous batch's deletions
    const batch = await Page.aggregate<EmptyLeafCandidate>([
      { $match: { isEmpty: true, path: { $ne: '/' } } },
      {
        $lookup: {
          from: 'pages',
          localField: '_id',
          foreignField: 'parent',
          pipeline: [{ $limit: 1 }, { $project: { _id: 1 } }],
          as: 'children',
        },
      },
      { $match: { children: { $size: 0 } } },
      { $project: { _id: 1, parent: 1 } },
      { $skip: skip },
      { $limit: BATCH_SIZE },
    ]);

    if (batch.length === 0) {
      return { removed, parentIds };
    }

    const res = await deleteStillOrphanedEmptyPages(batch);
    removed += res.removed;
    parentIds.push(...res.parentIds);
    skip += batch.length - res.removed;
  }
};

/**
 * Re-examines a known set of pages — the parents of what the previous pass removed —
 * and deletes the ones that have themselves become childless placeholders.
 */
const sweepCandidates = async (
  candidateIds: mongoose.Types.ObjectId[],
): Promise<SweepResult> => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  let removed = 0;
  const parentIds: mongoose.Types.ObjectId[] = [];

  for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
    const ids = candidateIds.slice(i, i + BATCH_SIZE);
    // biome-ignore lint/performance/noAwaitInLoops: bounded batches, sequential by design
    const batch = await Page.find<EmptyLeafCandidate>(
      { _id: { $in: ids }, isEmpty: true, path: { $ne: '/' } },
      { _id: 1, parent: 1 },
    ).lean();

    const res = await deleteStillOrphanedEmptyPages(batch);
    removed += res.removed;
    parentIds.push(...res.parentIds);
  }

  return { removed, parentIds };
};

/**
 * Removes empty placeholder pages that no longer connect anything.
 *
 * An empty page is a structural node that exists only to link a real descendant to
 * its ancestors; once childless it serves no purpose. Historically the WIP TTL index
 * deleted pages without running application code, so the placeholders that only
 * hosted them were left orphaned.
 *
 * Deleting one can leave its (also empty) parent childless, so the cascade repeats —
 * but only over the parents of what was just removed. Nothing else can have become a
 * childless empty page as a result of this run, so the previous shape (re-scan the
 * whole collection per cascade level) re-read every page to find, at most, a handful
 * of newly exposed leaves.
 *
 * @returns the number of pages removed
 */
export const removeEmptyLeafHierarchies = async (): Promise<number> => {
  const first = await sweepAllEmptyLeaves();

  let totalRemoved = first.removed;
  let candidateIds = first.parentIds;
  let pass = 1;

  for (; pass < MAX_PASSES && candidateIds.length > 0; pass++) {
    // biome-ignore lint/performance/noAwaitInLoops: each pass must observe the previous pass's deletions
    const res = await sweepCandidates(candidateIds);
    if (res.removed === 0) {
      return totalRemoved;
    }
    totalRemoved += res.removed;
    candidateIds = res.parentIds;
  }

  if (candidateIds.length > 0) {
    logger.warn(
      `Empty-page cleanup hit the ${MAX_PASSES}-pass cap without converging; some empty pages may remain. Investigate for a possible parent cycle.`,
    );
  }

  return totalRemoved;
};
