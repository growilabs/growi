import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type { BacklinksBackfillState } from '../../interfaces/page-link-backfill';
import {
  type BackfillPageCounts,
  toBacklinksBackfillState,
} from './backfill-admin-state';
import {
  BACKFILL_PAGE_CONDITION,
  type BackfillCoverage,
  backfillPageFilter,
  runRangeFor,
  toBackfillCoverage,
} from './backfill-range';

const countPages = (filter: Record<string, unknown>): Promise<number> =>
  mongoose.model<PageDocument, PageModel>('Page').countDocuments(filter).exec();

// Computed on read, not stored: design.md, "Counts shown to the admin".
const countPagesFor = async (
  coverage: BackfillCoverage,
): Promise<BackfillPageCounts> => {
  // Not included = what a run over every page would still walk.
  const range = runRangeFor(null, coverage);
  const [totalPageCount, notIncludedCount] = await Promise.all([
    countPages(BACKFILL_PAGE_CONDITION),
    range == null ? 0 : countPages(backfillPageFilter(range)),
  ]);
  return { totalPageCount, notIncludedCount };
};

/** The job state with its page counts; recreates the job document idle if it is missing. */
export const readBacklinksBackfillState =
  async (): Promise<BacklinksBackfillState> => {
    const jobs = prisma.pagelinkbackfilljobs;
    let job = await jobs.findFirst({});
    if (job == null) {
      await jobs.ensureExists();
      job = await jobs.findFirst({});
      if (job == null) throw new Error('backfill job document is missing');
    }
    const counts = await countPagesFor(
      toBackfillCoverage(job.coverage, job.coveredSince),
    );
    return toBacklinksBackfillState(job, counts);
  };
