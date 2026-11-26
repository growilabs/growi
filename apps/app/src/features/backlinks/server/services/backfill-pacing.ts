import { MAX_CHARGED_WORK_MS, restMsFor } from './duty-cycle-rest';
import { percentOrDefault, positiveIntOrDefault } from './pacing-config';

// Checkpoint cadence, attempt budget and lease margin are provisional values; design.md
// (PageLinkBackfillCron) records the reasoning and the inequality the lease must satisfy.

/** Save the marker and renew the lease after this many pages ... */
export const BACKFILL_CHECKPOINT_EVERY_PAGES = 100;
/** ... or after this long, whichever comes first (checked between pages). */
export const BACKFILL_CHECKPOINT_INTERVAL_MS = 10_000;

/** Mirrors the live drain's attempt budget: enough to ride out a replica-set failover. */
export const MAX_BACKFILL_PAGE_ATTEMPTS = 5;
export const BACKFILL_PAGE_RETRY_BACKOFF_MS = 5000;

/** Covers the page cycles of one page's attempts and the checkpoint write's own latency. */
const LEASE_MARGIN_MS = 15_000;

export interface BackfillPacing {
  /** Share of the event loop the backfill may occupy (1-100). */
  readonly dutyCyclePercent: number;
  /** Floor on the interval between pages, as a rate. */
  readonly maxPagesPerSecond: number;
  /** Bodies above this many UTF-8 KiB are skipped rather than parsed. */
  readonly maxBodyKiB: number;
}

/** Validates the configured values, falling back per value to the CONFIG_DEFINITIONS default. */
export const resolveBackfillPacing = (configured: {
  dutyCyclePercent: number;
  maxPagesPerSecond: number;
  maxBodyKiB: number;
}): BackfillPacing => ({
  dutyCyclePercent: percentOrDefault(
    configured.dutyCyclePercent,
    'backlinks:backfillDutyCyclePercent',
  ),
  maxPagesPerSecond: positiveIntOrDefault(
    configured.maxPagesPerSecond,
    'backlinks:backfillMaxPagesPerSecond',
  ),
  maxBodyKiB: positiveIntOrDefault(
    configured.maxBodyKiB,
    'backlinks:backfillMaxBodyKiB',
  ),
});

const minPageIntervalMs = (pacing: BackfillPacing): number =>
  1000 / pacing.maxPagesPerSecond;

/**
 * The rest after a page whose whole cycle (body read, parse, writes) took `cycleMs`: the
 * duty-cycle rest, lengthened when needed so the next page cannot start before the rate floor.
 */
export const restAfterBackfillPageMs = (
  cycleMs: number,
  pacing: BackfillPacing,
): number => {
  const spentMs = Number.isFinite(cycleMs) && cycleMs > 0 ? cycleMs : 0;
  return Math.max(
    restMsFor(spentMs, pacing.dutyCyclePercent),
    minPageIntervalMs(pacing) - spentMs,
    0,
  );
};

export const longestBackfillRestMs = (pacing: BackfillPacing): number =>
  Math.max(
    restMsFor(MAX_CHARGED_WORK_MS, pacing.dutyCyclePercent),
    minPageIntervalMs(pacing),
  );

/**
 * Between two checkpoints a healthy loop spends at most the checkpoint interval, one page with
 * all its retry backoffs, and one rest; the lease outlasts that so the owner keeps its claim.
 */
export const backfillLeaseMsFor = (pacing: BackfillPacing): number =>
  BACKFILL_CHECKPOINT_INTERVAL_MS +
  longestBackfillRestMs(pacing) +
  (MAX_BACKFILL_PAGE_ATTEMPTS - 1) * BACKFILL_PAGE_RETRY_BACKOFF_MS +
  LEASE_MARGIN_MS;
