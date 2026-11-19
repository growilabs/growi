import { PageStatus } from '@growi/core';

export type BackfillCoverage =
  | { readonly coverage: 'none' }
  | { readonly coverage: 'partial'; readonly coveredSince: Date }
  | { readonly coverage: 'all' };

/** A half-open `updatedAt` range, `from <= updatedAt < until`; null means unbounded. */
export interface UpdatedAtRange {
  readonly from: Date | null;
  readonly until: Date | null;
}

/**
 * The pages the backfill scans, shared by the walk, the run's `runTotal`, the `maxPages` cutoff
 * lookup and the admin counts, so a page the walk skips never counts as "not included".
 *
 * Trashed sources are not indexed by the live drain either, and an empty page has no body to
 * link from. Both are matched null-safely: a legacy page's null status means published.
 */
export const BACKFILL_PAGE_CONDITION = {
  status: { $ne: PageStatus.STATUS_DELETED },
  isEmpty: { $ne: true },
} as const;

/** Reads the stored coverage; a partial one without its boundary reads as none (walk it all). */
export const toBackfillCoverage = (
  coverage: string,
  coveredSince: Date | null,
): BackfillCoverage => {
  if (coverage === 'all') return { coverage: 'all' };
  if (coverage === 'partial' && coveredSince != null) {
    return { coverage: 'partial', coveredSince };
  }
  return { coverage: 'none' };
};

/**
 * The gap a run walks: from its cutoff (none = all pages) up to the existing coverage boundary.
 *
 * @returns null when the coverage already includes the run's whole scope
 */
export const runRangeFor = (
  runCutoff: Date | null,
  current: BackfillCoverage,
): UpdatedAtRange | null => {
  switch (current.coverage) {
    case 'all':
      return null;
    case 'none':
      return { from: runCutoff, until: null };
    case 'partial':
      if (
        runCutoff != null &&
        runCutoff.getTime() >= current.coveredSince.getTime()
      ) {
        return null;
      }
      return { from: runCutoff, until: current.coveredSince };
  }
};

export type CompletedCoverage = Exclude<
  BackfillCoverage,
  { readonly coverage: 'none' }
>;

/** The coverage once a run over `runCutoff` has completed. */
export const coverageAfterRun = (
  runCutoff: Date | null,
  current: BackfillCoverage,
): CompletedCoverage => {
  if (runCutoff == null || current.coverage === 'all') {
    return { coverage: 'all' };
  }
  if (
    current.coverage === 'partial' &&
    current.coveredSince.getTime() <= runCutoff.getTime()
  ) {
    return current;
  }
  return { coverage: 'partial', coveredSince: runCutoff };
};

export const backfillPageFilter = (
  range: UpdatedAtRange,
): Record<string, unknown> => {
  const updatedAt = {
    ...(range.from != null ? { $gte: range.from } : {}),
    ...(range.until != null ? { $lt: range.until } : {}),
  };
  return Object.keys(updatedAt).length > 0
    ? { ...BACKFILL_PAGE_CONDITION, updatedAt }
    : { ...BACKFILL_PAGE_CONDITION };
};
