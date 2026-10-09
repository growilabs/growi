import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:service:page:repair-page-tree:remove-empty-leaf-hierarchies',
);

/**
 * Bounds every id array this module puts in a query. Unbounded, a large orphan
 * backlog builds a `$in` past the 16 MB BSON limit and fails the whole repair.
 */
const BATCH_SIZE = 1000;

/**
 * Backstops a data anomaly (e.g. a parent cycle) from spinning forever. Caps the
 * depth of the cascade, not how many pages can be removed.
 */
const MAX_PASSES = 100;

/**
 * Backstops the collection scan below. Counted in rounds, not documents — see the note
 * on sweepAllEmptyLeaves for why a document offset strands live orphans.
 */
const MAX_BARREN_ROUNDS = 2;

/** Enough to delete a candidate and climb one level. */
type EmptyLeafCandidate = {
  _id: mongoose.Types.ObjectId;
  parent?: mongoose.Types.ObjectId | null;
};

type SweepResult = {
  removed: number;
  parentIds: mongoose.Types.ObjectId[];
};

/**
 * Deletes the candidates that are still orphaned placeholders, reporting their
 * parents so the caller can climb one level.
 *
 * Candidates are a snapshot the caller took earlier, and the service can run against
 * a live site (only the admin endpoint gates on maintenance mode), so both conditions
 * are re-checked here: a page created under a candidate meanwhile would be orphaned,
 * and a placeholder can have been filled in by a real page creation
 * (preparePageDocumentToCreate reuses empty pages).
 *
 * Exported so the test can pass a stale snapshot instead of interleaving.
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

  // Includes parents of candidates the isEmpty re-assert rejected: one wasted
  // re-examination is cheaper than reading back which ids actually went.
  const parentIds = stillChildless
    .map((c) => c.parent)
    .filter((id): id is mongoose.Types.ObjectId => id != null);

  return { removed: res.deletedCount ?? 0, parentIds };
};

/**
 * Scans the whole collection, one bounded batch at a time.
 *
 * No offset is carried between iterations: the scan is self-consuming, returning only
 * what still matches, so deletions drop out on their own. A declined candidate stops
 * matching too — it gained a child or is no longer empty, the two conditions matched
 * below — so it cannot be re-offered either.
 *
 * An earlier version advanced a `$skip` past declined candidates to prevent that
 * re-offer. Since they were already gone from the result set, it stepped over live
 * orphans instead, stranding one per decline.
 */
const sweepAllEmptyLeaves = async (): Promise<SweepResult> => {
  const Page = mongoose.model<IPage, PageModel>('Page');

  let removed = 0;
  const parentIds: mongoose.Types.ObjectId[] = [];
  let barrenRounds = 0;

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
      { $limit: BATCH_SIZE },
    ]);

    if (batch.length === 0) {
      return { removed, parentIds };
    }

    const res = await deleteStillOrphanedEmptyPages(batch);
    removed += res.removed;
    parentIds.push(...res.parentIds);

    if (res.removed > 0) {
      barrenRounds = 0;
      continue;
    }

    // A candidate spared by a child that is itself removed before the next scan does
    // legitimately come back, so cap the ping-pong rather than trust it to settle.
    barrenRounds += 1;
    if (barrenRounds >= MAX_BARREN_ROUNDS) {
      logger.warn(
        `Empty-page scan declined every candidate in ${MAX_BARREN_ROUNDS} consecutive batches; stopping the collection scan. Pages are being created under the placeholders about as fast as they are scanned.`,
      );
      return { removed, parentIds };
    }
  }
};

/** Deletes whichever of the given pages have themselves become childless placeholders. */
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
 * An empty page exists only to link a real descendant to its ancestors; once
 * childless it serves no purpose. Historically the WIP TTL index deleted pages
 * without running application code, so the placeholders that only hosted them were
 * left orphaned.
 *
 * Deleting one can leave its (also empty) parent childless, so the cascade repeats —
 * but only over the parents of what was just removed, since nothing else can have
 * become childless as a result of this run.
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
