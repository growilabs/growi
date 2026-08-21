import loggerFactory from '~/utils/logger';

import { handlePageUpsertById } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-upsert-queue');

/** Bounds an absurd measurement (a host stall mid-extraction), not the duty cycle itself. */
const REST_CAP_MS = 10_000;

/**
 * Pacing budget, passed in so the defaults stay single-sourced in CONFIG_DEFINITIONS
 * (`backlinks:*`). Both are positive integers, which `resolveUpsertQueuePacing` guarantees.
 */
export interface PageLinkUpsertQueuePacing {
  /** Coalescing window: how long a dirty page waits before its links are re-extracted. */
  readonly drainIntervalMs: number;
  /** Share of the event loop this queue may occupy (1-100). */
  readonly dutyCyclePercent: number;
}

/**
 * Coalescing, paced queue of page ids whose outbound links need re-extracting (requirement 3.5).
 *
 * Holds ids, not documents, so repeated saves of one page collapse into a single extraction over
 * the latest stored body, and paces itself by duty cycle over measured extraction time — see
 * design.md B2.2 for why a pages-per-tick budget was replaced.
 *
 * Takes `getSiteUrl` and the pacing budget as input rather than a Crowi instance, which leaves it
 * unit-testable without one.
 */
export class PageLinkUpsertQueue {
  private getSiteUrl: () => string | undefined;
  private pacing: PageLinkUpsertQueuePacing;
  private pagesToUpsert: Set<string>;
  private drainTimer: NodeJS.Timeout | null;
  private draining: boolean;
  /** Rest milliseconds owed per millisecond worked. */
  private restRatio: number;

  constructor(
    getSiteUrl: () => string | undefined,
    pacing: PageLinkUpsertQueuePacing,
  ) {
    this.getSiteUrl = getSiteUrl;
    this.pacing = pacing;
    this.pagesToUpsert = new Set<string>();
    this.draining = false;
    this.drainTimer = null;
    this.restRatio = (100 - pacing.dutyCyclePercent) / pacing.dutyCyclePercent;
  }

  enqueue(pageId: string): void {
    this.pagesToUpsert.add(pageId);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    // A drain that never settles wedges this guard forever: accepted limitation, see tasks.md B2.2.
    if (this.drainTimer != null || this.draining) return;
    this.drainTimer = setTimeout(() => {
      // Not `void`: an unhandled rejection exits the process.
      this.drain().catch((err) =>
        logger.error({ err }, 'backlinks drain failed'),
      );
    }, this.pacing.drainIntervalMs);
    // A pending drain must not keep the process alive; dropped work self-heals on the next edit.
    this.drainTimer.unref();
  }

  private restMsFor(extractionMs: number): number {
    if (!Number.isFinite(extractionMs) || extractionMs <= 0) return 0;
    return Math.min(extractionMs * this.restRatio, REST_CAP_MS);
  }

  private rest(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms).unref();
    });
  }

  private async drain(): Promise<void> {
    this.drainTimer = null;
    this.draining = true;

    try {
      for (const id of this.pagesToUpsert) {
        // Per page, before the id is claimed, so a throw here leaves the id queued rather than
        // dropping it or extracting with no site URL (which would delete correct rows).
        const siteUrl = this.getSiteUrl();

        // Claim before processing: a save landing mid-drain re-enqueues the id for a fresh run.
        this.pagesToUpsert.delete(id);

        let extractionMs = 0;
        try {
          // biome-ignore lint/performance/noAwaitInLoops: pacing is the point — parses run one at a time so the event loop is yielded between them (req 3.5)
          extractionMs = await handlePageUpsertById(id, siteUrl);
        } catch (err) {
          // Accepted: the page keeps its stale rows until its next save or the backfill (B3).
          logger.error({ err, pageId: id }, 'backlinks sync failed');
        }

        const restMs = this.restMsFor(extractionMs);
        if (restMs > 0) await this.rest(restMs);
      }
    } finally {
      this.draining = false;
      if (this.pagesToUpsert.size > 0) this.scheduleDrain();
    }
  }
}
