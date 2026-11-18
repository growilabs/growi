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
import { type BackfillPacing, backfillLeaseMsFor } from './backfill-pacing';
import {
  type BackfillRunDeps,
  runClaimedBackfill,
} from './page-link-backfill-run';

const logger = loggerFactory(
  'growi:features:backlinks:page-link-backfill-cron',
);

export interface PageLinkBackfillCronDeps {
  /** The idle poll's node-cron schedule. */
  readonly cronSchedule: string;
  readonly pacing: BackfillPacing;
  readonly getSiteUrl: () => string | undefined;
  readonly emitProgress: (data: BacklinksBackfillProgressData) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The idle poll runs every minute; design.md (PageLinkBackfillCron) has the reasoning. */
export const BACKFILL_POLL_CRON_SCHEDULE = '* * * * *';

interface JobClaimState {
  readonly status: string;
  readonly claimedBy: string | null;
  readonly leaseExpiresAt: Date | null;
}

/**
 * Whether the idle tick should try to claim. Cheap pre-check on the instance clock only: the
 * claim itself judges expiry on the database clock.
 */
const isPendingForClaim = (job: JobClaimState, nowMs: number): boolean => {
  if (job.status === 'requested') return true;
  if (job.status !== 'running' && job.status !== 'failed') return false;
  return (
    job.claimedBy == null ||
    job.leaseExpiresAt == null ||
    job.leaseExpiresAt.getTime() < nowMs
  );
};

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
 * The backfill's start poll: each tick reads the job document and, when it holds a request or a
 * run nobody is holding, claims it and runs the paced loop until the run ends.
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
    const now = this.deps.now ?? (() => performance.now());
    const job = await prisma.pagelinkbackfilljobs.findFirst({
      select: { status: true, claimedBy: true, leaseExpiresAt: true },
    });
    if (job == null || !isPendingForClaim(job, Date.now())) return;

    const leaseMs = backfillLeaseMsFor(this.deps.pacing);
    // Per claim, not per process: a stalled loop and its successor in the same process must not
    // both pass the claim fence.
    const owner = `${hostname()}:${process.pid}:${randomUUID()}`;
    const claimed = await prisma.pagelinkbackfilljobs.tryClaim(owner, {
      leaseMs,
    });
    if (!claimed) return;

    const runDeps: BackfillRunDeps = {
      pacing: this.deps.pacing,
      leaseMs,
      getSiteUrl: this.deps.getSiteUrl,
      emitProgress: this.deps.emitProgress,
      now,
      sleep:
        this.deps.sleep ??
        ((ms: number) => sleep(ms, undefined, { ref: false })),
    };
    logger.info({ owner }, 'backlinks backfill claimed the job');
    await runClaimedBackfill(owner, runDeps);
  }
}
