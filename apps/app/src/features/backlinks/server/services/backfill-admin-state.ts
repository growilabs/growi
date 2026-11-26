import type { pagelinkbackfilljobs } from '~/generated/prisma/client';

import type {
  BacklinksBackfillJobStatus,
  BacklinksBackfillState,
} from '../../interfaces/page-link-backfill';
import { toBackfillCoverage } from './backfill-range';

const JOB_STATUSES: ReadonlySet<string> = new Set<BacklinksBackfillJobStatus>([
  'idle',
  'requested',
  'running',
  'stopped',
  'complete',
  'failed',
]);

const isJobStatus = (status: string): status is BacklinksBackfillJobStatus =>
  JOB_STATUSES.has(status);

export type BackfillJobRow = Pick<
  pagelinkbackfilljobs,
  | 'status'
  | 'stopRequested'
  | 'processed'
  | 'runTotal'
  | 'skippedPages'
  | 'coverage'
  | 'coveredSince'
  | 'completedAt'
  | 'lastError'
  | 'failedAttempts'
  | 'retryAt'
>;

export interface BackfillPageCounts {
  readonly notIncludedCount: number;
  readonly totalPageCount: number;
}

/**
 * The state the admin sees. The claim (`claimedBy`, which names a host and pid) is left out.
 *
 * @throws when the stored status is not one the job writes
 */
export const toBacklinksBackfillState = (
  job: BackfillJobRow,
  counts: BackfillPageCounts,
): BacklinksBackfillState => {
  if (!isJobStatus(job.status)) {
    throw new Error(`unknown backfill job status: ${job.status}`);
  }
  const coverage = toBackfillCoverage(job.coverage, job.coveredSince);
  return {
    status: job.status,
    stopRequested: job.stopRequested,
    processed: job.processed,
    runTotal: job.runTotal,
    skippedPages: job.skippedPages,
    coverage: coverage.coverage,
    coveredSince:
      coverage.coverage === 'partial'
        ? coverage.coveredSince.toISOString()
        : null,
    completedAt: job.completedAt?.toISOString() ?? null,
    lastError: job.lastError,
    failedAttempts: job.failedAttempts,
    retryAt: job.retryAt?.toISOString() ?? null,
    ...counts,
  };
};
