import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import { SocketEventName } from '~/interfaces/websocket';
import CronService from '~/server/service/cron';
import type { SocketIoService } from '~/server/service/socket-io';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { BacklinksBackfillProgressData } from '../../interfaces/page-link-backfill';
import { backfillLeaseMsFor } from './backfill-pacing';
import {
  type BackfillRunDeps,
  runClaimedBackfill,
} from './page-link-backfill-run';

const logger = loggerFactory(
  'growi:features:backlinks:page-link-backfill-cron',
);

/** The run's dependencies minus the lease, which the cron derives from the pacing. */
export interface PageLinkBackfillCronDeps
  extends Omit<BackfillRunDeps, 'leaseMs' | 'now' | 'sleep'>,
    Partial<Pick<BackfillRunDeps, 'now' | 'sleep'>> {
  /** The idle poll's node-cron schedule. */
  readonly cronSchedule: string;
}

/** The idle poll runs every minute; design.md (PageLinkBackfillCron) has the reasoning. */
export const BACKFILL_POLL_CRON_SCHEDULE = '* * * * *';

/**
 * Sends backfill progress to the admin Socket.IO channel. A progress line is best-effort: before
 * the HTTP server attaches, or on an emit failure, it is dropped rather than failing the run.
 */
export const createAdminProgressEmitter =
  (
    socketIoService: Pick<SocketIoService, 'getAdminSocket'>,
  ): ((data: BacklinksBackfillProgressData) => void) =>
  (data) => {
    try {
      socketIoService
        .getAdminSocket()
        .emit(SocketEventName.BacklinksBackfillProgress, data);
    } catch (err) {
      logger.debug({ err }, 'backlinks backfill progress not emitted');
    }
  };

/**
 * The backfill's start poll: each tick tries to claim the job (a request, a run nobody is
 * holding, or a failed run whose retry is due) and, when it wins the claim, runs the paced loop
 * until the run ends. It runs only while a run is outstanding: a tick that wins nothing stops it
 * unless one is (design.md, Batch / Job Contract).
 */
export class PageLinkBackfillCron extends CronService {
  private readonly deps: PageLinkBackfillCronDeps;

  /** node-cron does not await a tick, so a tick falling due mid-run must not start a second loop. */
  private isRunning = false;

  /** Set by `claimNow` so a tick already in flight claims again instead of stopping the poll. */
  private isClaimRequested = false;

  constructor(deps: PageLinkBackfillCronDeps) {
    super();
    this.deps = deps;
  }

  override getCronSchedule(): string {
    return this.deps.cronSchedule;
  }

  override async executeJob(): Promise<void> {
    await this.runPendingJob();
  }

  /**
   * Claims and runs a pending job; returns at once when one is running here. Stops the poll
   * when nothing was claimed and no run is outstanding.
   */
  async runPendingJob(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      do {
        this.isClaimRequested = false;
        // biome-ignore lint/performance/noAwaitInLoops: claims are sequential by design
        const claimed = await this.claimAndRun();
        if (!claimed && !this.isClaimRequested) {
          await this.stopUnlessRunOutstanding();
        }
      } while (this.isClaimRequested);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * For the admin endpoints, after they write a request: make sure the poll runs in this
   * process and claim at once rather than on the next tick. Resolves when the claim, and any
   * run it started, has ended.
   */
  async claimNow(): Promise<void> {
    if (!this.isJobRunning()) this.startCron();
    this.isClaimRequested = true;
    await this.runPendingJob();
  }

  private async stopUnlessRunOutstanding(): Promise<void> {
    const outstanding = await prisma.pagelinkbackfilljobs.isRunOutstanding();
    // A claim asked for during the read may be for a request this read did not see.
    if (outstanding || this.isClaimRequested) return;
    this.stopCron();
    logger.info('backlinks backfill poll stopped: no run is outstanding');
  }

  /** @returns whether this process won the claim (and so ran the job) */
  private async claimAndRun(): Promise<boolean> {
    const leaseMs = backfillLeaseMsFor(this.deps.pacing);
    // Per claim, not per process: a stalled loop and its successor in the same process must not
    // both pass the claim fence.
    const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
    const claimed = await prisma.pagelinkbackfilljobs.tryClaim(owner, {
      leaseMs,
    });
    if (!claimed) return false;

    const runDeps: BackfillRunDeps = {
      ...this.deps,
      leaseMs,
      now: this.deps.now ?? (() => performance.now()),
      sleep:
        this.deps.sleep ??
        ((ms: number) => sleep(ms, undefined, { ref: false })),
    };
    logger.info({ owner }, 'backlinks backfill claimed the job');
    await runClaimedBackfill(owner, runDeps);
    return true;
  }
}
