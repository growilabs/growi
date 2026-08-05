import loggerFactory from '~/utils/logger';

import { handlePageUpsertById } from './page-link-service-handlers';

const logger = loggerFactory('growi:features:backlinks:page-link-upsert-queue');

/**
 * Pacing budget for the drain loop: how long a dirty page waits before its links are
 * re-extracted, and how many pages one tick may process.
 *
 * Passed in rather than read here so the defaults live in exactly one place
 * (`backlinks:drainIntervalMs` / `backlinks:maxPagesPerDrain` in CONFIG_DEFINITIONS).
 *
 * Both are assumed to be positive integers; `resolveUpsertQueuePacing` guarantees that for
 * config-sourced values.
 */
export interface PageLinkUpsertQueuePacing {
  readonly drainIntervalMs: number;
  readonly maxPagesPerDrain: number;
}

/**
 * Coalescing, paced queue of page ids whose outbound links need re-extracting
 * (requirement 3.5).
 *
 * Holds ids rather than documents so repeated saves of one page collapse into a
 * single extraction over the latest stored body, and drains a bounded number per
 * tick so an editing burst never becomes one blocking spree of markdown parses.
 *
 * Takes `getSiteUrl` and the pacing budget as constructor input rather than a Crowi
 * instance: the queue's job is pacing, and keeping config access at the boundary
 * leaves it unit-testable without a Crowi.
 */
export class PageLinkUpsertQueue {
  private getSiteUrl: () => string | undefined;
  private pacing: PageLinkUpsertQueuePacing;
  private pagesToUpsert: Set<string>;
  private drainTimer: NodeJS.Timeout | null;
  private draining: boolean;

  constructor(
    getSiteUrl: () => string | undefined,
    pacing: PageLinkUpsertQueuePacing,
  ) {
    this.getSiteUrl = getSiteUrl;
    this.pacing = pacing;
    this.pagesToUpsert = new Set<string>();
    this.draining = false;
    this.drainTimer = null;
  }

  /** Mark a page dirty; extraction happens on a later drain tick. */
  enqueue(pageId: string): void {
    this.pagesToUpsert.add(pageId);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainTimer != null || this.draining) return;
    this.drainTimer = setTimeout(() => {
      this.drain().catch((err) =>
        logger.error({ err }, 'backlinks drain failed'),
      );
    }, this.pacing.drainIntervalMs);
    // A pending drain must not keep the process alive; dropped work self-heals on the next edit.
    this.drainTimer.unref();
  }

  private async drain(): Promise<void> {
    this.drainTimer = null;
    this.draining = true;

    try {
      const siteUrl = this.getSiteUrl();

      // Taken by early break rather than [...set].slice(N): during a burst — the very case this
      // queue exists for — copying the whole set to read a few ids is the cost it is meant to avoid.
      // Set iteration is insertion-ordered, so this is the same FIFO batch the slice produced.
      const batch: string[] = [];
      for (const id of this.pagesToUpsert) {
        batch.push(id);
        if (batch.length >= this.pacing.maxPagesPerDrain) {
          break;
        }
      }

      // Remove before processing: a save landing mid-drain re-enqueues the id and gets a fresh
      // run, whereas removing afterwards would swallow that save's changes.
      for (const id of batch) {
        this.pagesToUpsert.delete(id);
      }

      for (const id of batch) {
        try {
          // biome-ignore lint/performance/noAwaitInLoops: pacing is the point — parses run one at a time so the event loop is yielded between them (req 3.5)
          await handlePageUpsertById(id, siteUrl);
        } catch (err) {
          logger.error({ err, pageId: id }, 'backlinks sync failed');
        }
      }
    } finally {
      this.draining = false;
      if (this.pagesToUpsert.size > 0) this.scheduleDrain();
    }
  }
}
