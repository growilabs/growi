import { performance } from 'node:perf_hooks';

import loggerFactory from '~/utils/logger';

import { handlePageUpsertById } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-upsert-queue');

/**
 * Ceiling on the work one page may be charged for, well above any real parse cost. Bounding the
 * charge rather than the resulting rest keeps the configured duty exact for every legitimate
 * measurement — clamping the rest instead raised the effective duty for expensive pages, worst at
 * a deliberately low duty, which is where the knob matters most.
 */
const MAX_CHARGED_EXTRACTION_MS = 5000;

/** Enough to ride out a replica-set failover, few enough not to chase a permanent fault. */
const MAX_UPSERT_ATTEMPTS = 5;

/** The drain timer is shared, so a save arriving during a retry backoff waits for it too. */
const RETRY_BACKOFF_MS = 5000;

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
  /** Failures so far per page; cleared on success or on giving up. */
  private attemptsByPage: Map<string, number>;

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
    this.attemptsByPage = new Map<string, number>();
  }

  enqueue(pageId: string): void {
    this.pagesToUpsert.add(pageId);
    // A save is new work, not another attempt at the same work: counting it against the retry
    // budget would abandon a page that is merely being edited while writes are failing.
    this.attemptsByPage.delete(pageId);
    this.scheduleDrain();
  }

  private scheduleDrain(delayMs = this.pacing.drainIntervalMs): void {
    // A drain that never settles wedges this guard forever: accepted limitation, see tasks.md B2.2.
    if (this.drainTimer != null || this.draining) return;
    this.drainTimer = setTimeout(() => {
      // Not `void`: an unhandled rejection exits the process.
      this.drain().catch((err) =>
        logger.error({ err }, 'backlinks drain failed'),
      );
    }, delayMs);
    // A pending drain must not keep the process alive; dropped work self-heals on the next edit.
    this.drainTimer.unref();
  }

  /** @returns whether the page gets another attempt. */
  private registerFailure(id: string, err: unknown): boolean {
    const attempts = (this.attemptsByPage.get(id) ?? 0) + 1;
    logger.error({ err, pageId: id, attempts }, 'backlinks sync failed');

    if (attempts < MAX_UPSERT_ATTEMPTS) {
      this.attemptsByPage.set(id, attempts);
      return true;
    }

    this.attemptsByPage.delete(id);
    logger.error(
      { pageId: id, attempts },
      'backlinks sync giving up on this page; its links stay stale until its next save or the backfill',
    );
    return false;
  }

  private restMsFor(extractionMs: number): number {
    if (!Number.isFinite(extractionMs) || extractionMs <= 0) return 0;
    const charged = Math.min(extractionMs, MAX_CHARGED_EXTRACTION_MS);
    return charged * this.restRatio;
  }

  private rest(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms).unref();
    });
  }

  private async drain(): Promise<void> {
    this.drainTimer = null;
    this.draining = true;

    // Per drain: kept on the instance, one failure would re-queue the page on every later drain.
    const failed = new Set<string>();

    try {
      for (const id of this.pagesToUpsert) {
        this.pagesToUpsert.delete(id);

        let siteUrl: string | undefined;
        try {
          siteUrl = this.getSiteUrl();
        } catch (err) {
          // A config/infra fault, not a page-specific one: go straight to `failed` rather than
          // through registerFailure, so it never spends this page's MAX_UPSERT_ATTEMPTS budget —
          // it retries indefinitely, for as long as the fault lasts. getSiteUrl() is the same call
          // for every id in this pass, so a throw here means the rest would throw too; bail out of
          // the pass now instead of repeating the same failed call (and log line) per remaining id.
          logger.error(
            { err, pageId: id },
            'backlinks sync failed: site URL unreachable',
          );
          failed.add(id);
          for (const remainingId of this.pagesToUpsert) failed.add(remainingId);
          break;
        }

        const startedAt = performance.now();
        let extractionMs = 0;
        try {
          // biome-ignore lint/performance/noAwaitInLoops: pacing is the point — parses run one at a time so the event loop is yielded between them (req 3.5)
          extractionMs = await handlePageUpsertById(id, siteUrl);
          this.attemptsByPage.delete(id);
          // It may have failed earlier in this same drain (a mid-drain save re-enqueues the id and
          // the live Set revisits it), so drop the pending retry too.
          failed.delete(id);
        } catch (err) {
          // A failure after a completed extraction never reports its cost, so charge elapsed.
          extractionMs = performance.now() - startedAt;
          if (this.registerFailure(id, err)) failed.add(id);
        }

        const restMs = this.restMsFor(extractionMs);
        if (restMs > 0) await this.rest(restMs);
      }
    } finally {
      for (const id of failed) this.pagesToUpsert.add(id);

      this.draining = false;
      if (this.pagesToUpsert.size > 0) {
        this.scheduleDrain(failed.size > 0 ? RETRY_BACKOFF_MS : undefined);
      }
    }
  }
}
