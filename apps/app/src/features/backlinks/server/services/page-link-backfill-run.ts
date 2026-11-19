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
  type BackfillCoverage,
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

const NO_PROGRESS: BackfillProgress = {
  progressMarker: null,
  processed: 0,
  skippedPages: 0,
};

/** What a run walks and reports against, fixed at its first claim. */
interface RunPlan {
  readonly runCutoff: Date | null;
  readonly runTotal: number;
  /** Where the walk continues from: nothing on a new run, the last checkpoint on a resume. */
  readonly progress: BackfillProgress;
}

type RunEnd = 'complete' | 'stopped' | 'refused';

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
  try {
    const end = await runToEnd(owner, deps);
    if (end === 'refused') await onRefused(owner);
  } catch (err) {
    logger.error({ err, owner }, 'backlinks backfill run failed');
    const recorded = await prisma.pagelinkbackfilljobs.finishFailed(
      owner,
      err instanceof Error ? err.message : String(err),
    );
    if (!recorded) await onRefused(owner);
  }
};

const onRefused = async (owner: string): Promise<void> => {
  logger.warn(
    { owner },
    'backlinks backfill lost its claim on the job; stopping without writing',
  );
  // A no-op on a document that still exists; recreates a deleted one idle.
  await prisma.pagelinkbackfilljobs.ensureExists();
};

const runToEnd = async (
  owner: string,
  deps: BackfillRunDeps,
): Promise<RunEnd> => {
  const jobs = prisma.pagelinkbackfilljobs;
  const job = await jobs.findFirst({});
  if (job == null || job.claimedBy !== owner) return 'refused';
  const coverage = toBackfillCoverage(job.coverage, job.coveredSince);

  // `runTotal` is written once, at the first claim, so it tells a new run from a resume.
  const plan =
    job.runTotal == null
      ? await beginRun(owner, job.requestedScope, coverage, deps)
      : {
          runCutoff: job.runCutoff,
          runTotal: job.runTotal,
          progress: {
            progressMarker: job.progressMarker,
            processed: job.processed,
            skippedPages: job.skippedPages,
          },
        };
  if (plan == null) return 'refused';

  const emit = (
    status: BacklinksBackfillProgressData['status'],
    progress: BackfillProgress,
  ) =>
    deps.emitProgress({
      status,
      runTotal: plan.runTotal,
      ...progressCounts(progress),
    });
  emit('running', plan.progress);

  const range = runRangeFor(plan.runCutoff, coverage);
  const { end, progress } =
    range == null
      ? { end: 'exhausted' as const, progress: plan.progress }
      : await walk({ owner, range, initial: plan.progress }, deps, {
          onCheckpoint: (saved) => emit('running', saved),
        });
  if (end === 'refused') return 'refused';
  if (end === 'stopped') {
    emit('stopped', progress);
    return 'stopped';
  }

  const completed = await jobs.finishComplete(
    owner,
    progress,
    coverageAfterRun(plan.runCutoff, coverage),
  );
  if (!completed) return 'refused';
  emit('complete', progress);
  logger.info(
    { ...progressCounts(progress), runTotal: plan.runTotal },
    'backlinks backfill run complete',
  );
  return 'complete';
};

/**
 * The first claim of a run: resolve the scope to its cutoff, count the pages in range, and store
 * both with the progress reset.
 *
 * @returns null when the claim was lost before the write
 */
const beginRun = async (
  owner: string,
  scope: RequestedScope | null,
  coverage: BackfillCoverage,
  deps: BackfillRunDeps,
): Promise<RunPlan | null> => {
  const runCutoff = await resolveRunCutoff(scope);
  const range = runRangeFor(runCutoff, coverage);
  const runTotal =
    range == null
      ? 0
      : await getPageModel().countDocuments(backfillPageFilter(range));
  const started = await prisma.pagelinkbackfilljobs.startRun(
    owner,
    { runCutoff, runTotal },
    { leaseMs: deps.leaseMs },
  );
  return started ? { runCutoff, runTotal, progress: NO_PROGRESS } : null;
};

const progressCounts = (progress: BackfillProgress) => ({
  processed: progress.processed,
  skippedPages: progress.skippedPages,
});

interface WalkTarget {
  readonly owner: string;
  readonly range: UpdatedAtRange;
  /** The saved progress the walk continues after. */
  readonly initial: BackfillProgress;
}

interface WalkResult {
  readonly end: WalkEnd;
  /** The progress past the last page walked, saved or not: complete saves it. */
  readonly progress: BackfillProgress;
}

/** Walks the range page by page, resting after each, checkpointing every N pages or T ms. */
const walk = async (
  { owner, range, initial }: WalkTarget,
  deps: BackfillRunDeps,
  {
    onCheckpoint,
  }: { readonly onCheckpoint: (saved: BackfillProgress) => void },
): Promise<WalkResult> => {
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
    if (batch.length === 0) return { end: 'exhausted', progress };

    for (const page of batch) {
      // biome-ignore lint/performance/noAwaitInLoops: one page at a time is the throttle
      const { outcome, workMs } = await backfillPage(page, ctx);
      progress = advance(progress, page._id, outcome);
      pagesSinceCheckpoint += 1;

      if (
        pagesSinceCheckpoint >= BACKFILL_CHECKPOINT_EVERY_PAGES ||
        deps.now() - lastCheckpointAt >= BACKFILL_CHECKPOINT_INTERVAL_MS
      ) {
        const reply = await jobs.checkpoint(owner, progress, {
          leaseMs: deps.leaseMs,
        });
        if (reply == null) return { end: 'refused', progress };
        onCheckpoint(progress);
        if (reply.stopRequested) {
          const stopped = await jobs.finishStopped(owner, progress);
          return { end: stopped ? 'stopped' : 'refused', progress };
        }
        lastCheckpointAt = deps.now();
        pagesSinceCheckpoint = 0;
      }

      await deps.sleep(restAfterBackfillPageMs(workMs, deps.pacing));
    }
  }
};
