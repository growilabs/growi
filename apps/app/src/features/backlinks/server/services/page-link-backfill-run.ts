import mongoose, { type Types } from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import {
  BackfillScopeKind,
  type BacklinksBackfillProgressData,
} from '../../interfaces/page-link-backfill';
import type { BackfillProgress } from '../models/page-link-backfill-job';
import { loadBackfillLinkResolver } from './backfill-link-resolver';
import {
  BACKFILL_CHECKPOINT_EVERY_PAGES,
  BACKFILL_CHECKPOINT_INTERVAL_MS,
  type BackfillPacing,
  restAfterBackfillPageMs,
} from './backfill-pacing';
import {
  type BackfillPageContext,
  type BackfillPageRow,
  backfillPage,
} from './backfill-page';
import {
  BACKFILL_PAGE_CONDITION,
  backfillPageFilter,
  coverageAfterRun,
  runRangeFor,
  toBackfillCoverage,
  type UpdatedAtRange,
} from './backfill-range';

const logger = loggerFactory('growi:features:backlinks:page-link-backfill-run');

/** Pages fetched per keyset query; only `_id`, `path` and `revision` are read. */
const WALK_BATCH_SIZE = 100;

export interface BackfillRunDeps {
  readonly pacing: BackfillPacing;
  readonly leaseMs: number;
  readonly getSiteUrl: () => string | undefined;
  readonly emitProgress: (data: BacklinksBackfillProgressData) => void;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

interface RequestedScope {
  readonly kind: string;
  readonly maxPages: number | null;
  readonly since: Date | null;
}

type WalkEnd = 'exhausted' | 'stopped' | 'refused';

const getPageModel = () => mongoose.model<PageDocument, PageModel>('Page');

/** The scope's `updatedAt` lower bound; null when the scope reaches the oldest page. */
const resolveRunCutoff = async (
  scope: RequestedScope | null,
): Promise<Date | null> => {
  switch (scope?.kind) {
    case BackfillScopeKind.ALL:
      return null;
    case BackfillScopeKind.SINCE:
      if (scope.since == null) throw new Error('since scope has no date');
      return scope.since;
    case BackfillScopeKind.MAX_PAGES: {
      const { maxPages } = scope;
      if (maxPages == null || !Number.isInteger(maxPages) || maxPages <= 0) {
        throw new Error(`maxPages scope is invalid: ${String(maxPages)}`);
      }
      // Fewer pages than N means the scope is every page, so the run can end with coverage `all`.
      const nth = await getPageModel()
        .findOne(BACKFILL_PAGE_CONDITION)
        .sort({ updatedAt: -1 })
        .skip(maxPages - 1)
        .select({ updatedAt: 1 })
        .lean<{ updatedAt: Date }>();
      return nth?.updatedAt ?? null;
    }
    default:
      throw new Error(`unknown backfill scope: ${String(scope?.kind)}`);
  }
};

const fetchBatch = (
  range: UpdatedAtRange,
  after: string | null,
): Promise<BackfillPageRow[]> =>
  getPageModel()
    .find({
      ...backfillPageFilter(range),
      ...(after != null
        ? { _id: { $gt: new mongoose.Types.ObjectId(after) } }
        : {}),
    })
    .sort({ _id: 1 })
    .limit(WALK_BATCH_SIZE)
    .select({ _id: 1, path: 1, revision: 1 })
    .lean<BackfillPageRow[]>()
    .exec();

const advance = (
  progress: BackfillProgress,
  pageId: Types.ObjectId,
  outcome: 'indexed' | 'skipped',
): BackfillProgress => ({
  progressMarker: pageId.toString(),
  processed: progress.processed + 1,
  skippedPages: progress.skippedPages + (outcome === 'skipped' ? 1 : 0),
});

/**
 * One run of a claimed job: resolve the scope at the first claim, walk the range in `_id` order
 * after the saved marker, checkpoint, and end it as complete or stopped.
 *
 * Ending on a refused write touches nothing (another instance owns the job now, or the document
 * is gone and is recreated idle); an error ends the run as `failed`.
 */
export const runClaimedBackfill = async (
  owner: string,
  deps: BackfillRunDeps,
): Promise<void> => {
  const jobs = prisma.pagelinkbackfilljobs;
  const onRefused = async (): Promise<void> => {
    logger.warn(
      { owner },
      'backlinks backfill lost its claim on the job; stopping without writing',
    );
    // A no-op on a document that still exists; recreates a deleted one idle.
    await jobs.ensureExists();
  };

  let progress: BackfillProgress = {
    progressMarker: null,
    processed: 0,
    skippedPages: 0,
  };
  let runTotal = 0;
  const emit = (status: BacklinksBackfillProgressData['status']) =>
    deps.emitProgress({ status, runTotal, ...progressCounts(progress) });

  try {
    const job = await jobs.findFirst({});
    if (job == null || job.claimedBy !== owner) {
      await onRefused();
      return;
    }
    const coverage = toBackfillCoverage(job.coverage, job.coveredSince);

    let runCutoff: Date | null;
    if (job.runTotal == null) {
      runCutoff = await resolveRunCutoff(job.requestedScope);
      const range = runRangeFor(runCutoff, coverage);
      runTotal =
        range == null
          ? 0
          : await getPageModel().countDocuments(backfillPageFilter(range));
      const started = await jobs.startRun(
        owner,
        { runCutoff, runTotal },
        { leaseMs: deps.leaseMs },
      );
      if (!started) {
        await onRefused();
        return;
      }
    } else {
      runCutoff = job.runCutoff;
      runTotal = job.runTotal;
      progress = {
        progressMarker: job.progressMarker,
        processed: job.processed,
        skippedPages: job.skippedPages,
      };
    }
    emit('running');

    const range = runRangeFor(runCutoff, coverage);
    if (range != null) {
      const end = await walk({ owner, range, initial: progress }, deps, {
        advanced: (next) => {
          progress = next;
        },
        checkpointed: () => emit('running'),
      });
      if (end === 'refused') {
        await onRefused();
        return;
      }
      if (end === 'stopped') {
        emit('stopped');
        return;
      }
    }

    const completed = await jobs.finishComplete(
      owner,
      progress,
      toCoverageRecord(coverageAfterRun(runCutoff, coverage)),
    );
    if (!completed) {
      await onRefused();
      return;
    }
    emit('complete');
    logger.info(
      { ...progressCounts(progress), runTotal },
      'backlinks backfill run complete',
    );
  } catch (err) {
    logger.error({ err, owner }, 'backlinks backfill run failed');
    const recorded = await jobs.finishFailed(
      owner,
      err instanceof Error ? err.message : String(err),
    );
    if (!recorded) await onRefused();
  }
};

const progressCounts = (progress: BackfillProgress) => ({
  processed: progress.processed,
  skippedPages: progress.skippedPages,
});

const toCoverageRecord = (coverage: ReturnType<typeof coverageAfterRun>) =>
  coverage.coverage === 'partial'
    ? { coverage: 'partial' as const, coveredSince: coverage.coveredSince }
    : { coverage: 'all' as const, coveredSince: null };

interface WalkListener {
  /** After each page, with the marker past it: the caller's progress for any ending. */
  readonly advanced: (progress: BackfillProgress) => void;
  readonly checkpointed: () => void;
}

interface WalkTarget {
  readonly owner: string;
  readonly range: UpdatedAtRange;
  /** The saved progress the walk continues after. */
  readonly initial: BackfillProgress;
}

/** Walks the range page by page, resting after each, checkpointing every N pages or T ms. */
const walk = async (
  { owner, range, initial }: WalkTarget,
  deps: BackfillRunDeps,
  listener: WalkListener,
): Promise<WalkEnd> => {
  const jobs = prisma.pagelinkbackfilljobs;
  let lastCheckpointAt = deps.now();
  let pagesSinceCheckpoint = 0;
  let progress = initial;

  const ctx: BackfillPageContext = {
    resolve: await loadBackfillLinkResolver(),
    siteUrl: deps.getSiteUrl(),
    maxBodyBytes: deps.pacing.maxBodyKiB * 1024,
    now: deps.now,
    sleep: deps.sleep,
  };

  for (;;) {
    // Keyset batches rather than one long-lived cursor: the rests between pages could otherwise
    // outlast the server's idle cursor timeout.
    // biome-ignore lint/performance/noAwaitInLoops: the walk is sequential and paced by design
    const batch = await fetchBatch(range, progress.progressMarker);
    if (batch.length === 0) return 'exhausted';

    for (const page of batch) {
      // biome-ignore lint/performance/noAwaitInLoops: one page at a time is the throttle
      const { outcome, workMs } = await backfillPage(page, ctx);
      progress = advance(progress, page._id, outcome);
      listener.advanced(progress);
      pagesSinceCheckpoint += 1;

      if (
        pagesSinceCheckpoint >= BACKFILL_CHECKPOINT_EVERY_PAGES ||
        deps.now() - lastCheckpointAt >= BACKFILL_CHECKPOINT_INTERVAL_MS
      ) {
        const reply = await jobs.checkpoint(owner, progress, {
          leaseMs: deps.leaseMs,
        });
        if (reply == null) return 'refused';
        listener.checkpointed();
        if (reply.stopRequested) {
          const stopped = await jobs.finishStopped(owner, progress);
          return stopped ? 'stopped' : 'refused';
        }
        lastCheckpointAt = deps.now();
        pagesSinceCheckpoint = 0;
      }

      await deps.sleep(restAfterBackfillPageMs(workMs, deps.pacing));
    }
  }
};
