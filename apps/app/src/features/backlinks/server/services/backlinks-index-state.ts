import type { pagelinkbackfilljobs } from '~/generated/prisma/client';

import type { IBacklinksIndexState } from '../../interfaces/backlink';
import { toBackfillCoverage } from './backfill-range';

export type BacklinksIndexJobRow = Pick<
  pagelinkbackfilljobs,
  'coverage' | 'coveredSince'
>;

/** The panel's summary of the job; a missing document reads as not built (design.md). */
export const toBacklinksIndexState = (
  job: BacklinksIndexJobRow | null,
): IBacklinksIndexState => {
  if (job == null) {
    return { coverage: 'none', coveredSince: null };
  }
  const coverage = toBackfillCoverage(job.coverage, job.coveredSince);
  return {
    coverage: coverage.coverage,
    coveredSince:
      coverage.coverage === 'partial'
        ? coverage.coveredSince.toISOString()
        : null,
  };
};
