import type { ExtractionOutcome } from '~/features/search-attachments/interfaces/attachment-search';

import { FILE_READ_FAILED } from './attachment-text-extractor';

/**
 * Outage-like failures any rebuild may have, whatever its size: a healthy
 * run sees one now and then (one large file timing out, one dropped
 * connection), and a small instance must not abort over a handful of them.
 */
export const OUTAGE_FAILURE_ALLOWANCE = 20;

/**
 * Further outage-like failures allowed per attachment, so a large rebuild
 * tolerates proportionally more. An outage fails every attachment from its
 * start, so the budget still runs out within a few percent of the scan,
 * before the alias could move to an index of empty docs.
 */
export const OUTAGE_FAILURE_RATIO = 0.05;

/**
 * The extractor or the file storage did not do its part; nothing is known
 * about the file itself.
 */
const isOutageFailure = (outcome: ExtractionOutcome): boolean =>
  outcome.kind === 'serviceUnreachable' ||
  outcome.kind === 'serviceBusy' ||
  (outcome.kind === 'failed' && outcome.reasonCode === FILE_READ_FAILED);

/** The outage-like failure count at which a rebuild over `total` stops. */
export const outageFailureLimit = (total: number): number =>
  OUTAGE_FAILURE_ALLOWANCE + Math.ceil(total * OUTAGE_FAILURE_RATIO);

export type RebuildFailureBudget = {
  /** Feeds one outcome; true once the run should stop now. */
  record(outcome: ExtractionOutcome): boolean;
  /**
   * True when the run processed attachments but every outcome was
   * outage-like: nothing was read or judged, so the new index holds nothing
   * worth swapping in. Catches runs too small to reach the limit.
   */
  shouldAbortAtEnd(): boolean;
};

/**
 * The failure budget of a rebuild over `total` attachments: it stops once
 * outage-like failures, counted over the whole run, reach
 * `outageFailureLimit(total)`.
 */
export const createRebuildFailureBudget = (
  total: number,
): RebuildFailureBudget => {
  const limit = outageFailureLimit(total);
  let failures = 0;
  let others = 0;
  return {
    record(outcome) {
      if (isOutageFailure(outcome)) {
        failures += 1;
      } else {
        others += 1;
      }
      return failures >= limit;
    },
    shouldAbortAtEnd: () => failures > 0 && others === 0,
  };
};
