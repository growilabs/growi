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
 * The backfill's start poll: each tick tries to claim the job (a request, or a run nobody is
 * holding) and, when it wins the claim, runs the paced loop until the run ends.
 */
export class PageLinkBackfillCron extends CronService {
  private readonly deps: PageLinkBackfillCronDeps;

  /** node-cron does not await a tick, so a tick falling due mid-run must not start a second loop. */
  private isRunning = false;

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

  /** Claims and runs a pending job; returns at once when one is running here or none is pending. */
  async runPendingJob(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.claimAndRun();
    } finally {
      this.isRunning = false;
    }
  }

  private async claimAndRun(): Promise<void> {
    const leaseMs = backfillLeaseMsFor(this.deps.pacing);
    // Per claim, not per process: a stalled loop and its successor in the same process must not
    // both pass the claim fence.
    const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
    const claimed = await prisma.pagelinkbackfilljobs.tryClaim(owner, {
      leaseMs,
    });
    if (!claimed) return;

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
  }
}
