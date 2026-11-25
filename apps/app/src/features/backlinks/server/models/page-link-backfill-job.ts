import type { Prisma, PrismaClient } from '~/generated/prisma/client';

import { throwOnWriteErrors } from './throw-on-write-errors';

const COLLECTION = 'pagelinkbackfilljobs';

// The one control document is addressed by a fixed `_id`, so concurrent boots cannot create a
// second one and no unique index (and so no migration) is needed.
const JOB_ID = { $oid: '000000000000000000000001' };

export interface BackfillClaimOptions {
  /** How long the claim stays valid without a renewal. */
  readonly leaseMs: number;
}

/** Where the running loop is, as saved at a checkpoint and at every ending. */
export interface BackfillProgress {
  /** Hex `_id` of the last page whose rows are written; null before the first one. */
  readonly progressMarker: string | null;
  readonly processed: number;
  readonly skippedPages: number;
}

export interface BackfillRunStart {
  /** The `updatedAt` lower bound the scope resolved to; null for all pages. */
  readonly runCutoff: Date | null;
  readonly runTotal: number;
}

export type BackfillCoverageRecord =
  | { readonly coverage: 'partial'; readonly coveredSince: Date }
  | { readonly coverage: 'all' };

/** The checkpoint's view of the admin-owned fields, from the document it just wrote. */
export interface BackfillCheckpointReply {
  readonly stopRequested: boolean;
}

export interface BackfillFailureOptions {
  /**
   * The wait before each retry of a failed run, by the number of failures in a row; its length
   * is the cap. One more failure in a row leaves the job for the admin.
   */
  readonly retryDelaysMs: readonly number[];
}

const assertValidLeaseMs = (leaseMs: number): void => {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('leaseMs value is invalid');
  }
};

const assertValidRetryDelays = (retryDelaysMs: readonly number[]): void => {
  if (!retryDelaysMs.every((ms) => Number.isFinite(ms) && ms > 0)) {
    throw new Error('retryDelaysMs value is invalid');
  }
};

const toOid = (hex: string | null) => (hex != null ? { $oid: hex } : null);
const toDate = (date: Date | null) =>
  date != null ? { $date: date.toISOString() } : null;

const progressFields = (progress: BackfillProgress) => ({
  progressMarker: toOid(progress.progressMarker),
  processed: progress.processed,
  skippedPages: progress.skippedPages,
});

/** Released by every ending, so the next claim needs no lease expiry. */
const releaseClaimFields = {
  claimedBy: null,
  leaseExpiresAt: null,
};

/** No failures in a row and no retry due: written wherever a run makes progress or settles. */
const noFailureFields = {
  failedAttempts: 0,
  retryAt: null,
};

/** Written by the endings that settle a Stop: the run is over, so a pending one is moot. */
const settledEndingFields = {
  ...releaseClaimFields,
  ...noFailureFields,
  stopRequested: false,
};

// A run is outstanding while it is requested, running, or failed with a retry due: the poll
// runs only then (design.md, Batch / Job Contract). A query filter, where `$ne: null` also
// excludes a document written before `retryAt` existed.
const RUN_OUTSTANDING_FILTER = {
  _id: JOB_ID,
  $or: [
    { status: { $in: ['requested', 'running'] } },
    { status: 'failed', retryAt: { $ne: null } },
  ],
};

// Raw commands, not the query API: Prisma's `upsert` has no `$setOnInsert`, and `update`
// injects a `v` increment this v-less collection does not have.
//
// Returned as a model definition, not a `defineExtension` of its own: `page-link.ts` mounts it
// in its existing extension, because every extra `.$extends` in `utils/prisma.ts` lengthens
// the client type until `lint:typecheck` fails with TS2589 in unrelated files.
export const createPageLinkBackfillJobModel = (
  client: Pick<PrismaClient, '$runCommandRaw'>,
) => {
  // A pipeline update, so a lease or a timestamp can be taken from the database clock. Every
  // string that is data goes through `$literal`, or one starting with `$` would be read as a
  // field path.
  const fencedWrite = async (
    owner: string,
    context: string,
    set: Prisma.InputJsonObject,
  ): Promise<Prisma.JsonObject | null> => {
    const result = await client.$runCommandRaw({
      findAndModify: COLLECTION,
      query: { _id: JOB_ID, claimedBy: owner, status: 'running' },
      update: [{ $set: set }],
      new: true,
    });
    throwOnWriteErrors(result, `backfill job ${context}`);
    const { value } = result;
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  };

  return {
    /**
     * Create the job document idle if it is missing; never touch an existing one, so coverage
     * and progress survive every later boot.
     *
     * Every field is written because raw inserts do not get the schema's `@default`s.
     */
    async ensureExists(): Promise<void> {
      const result = await client.$runCommandRaw({
        update: COLLECTION,
        updates: [
          {
            q: { _id: JOB_ID },
            u: {
              $setOnInsert: {
                status: 'idle',
                requestedScope: null,
                requestedAt: null,
                stopRequested: false,
                runCutoff: null,
                runTotal: null,
                coverage: 'none',
                coveredSince: null,
                progressMarker: null,
                processed: 0,
                skippedPages: 0,
                completedAt: null,
                lastError: null,
                ...noFailureFields,
                claimedBy: null,
                leaseExpiresAt: null,
              },
            },
            upsert: true,
          },
        ],
      });
      throwOnWriteErrors(result, 'backfill job ensureExists');
    },

    /**
     * Atomically claim the job for `owner`. Succeeds only for a `requested` job, a `running`
     * one that nobody holds or whose holder's lease has expired, or a `failed` one whose
     * `retryAt` has passed. Any other job is never handed out (rationale: design.md, "Stop and
     * resume" and "Failed run").
     *
     * A claim from `requested` clears any stale `stopRequested` in the same write; a take-over
     * keeps it, so a live Stop is not lost. Every claim clears `retryAt`; `failedAttempts` stays
     * until the run's first checkpoint.
     *
     * Expiry and the retry time are judged on the database clock (`$$NOW`), so instances whose
     * own clocks disagree cannot steal a live claim from each other.
     *
     * @throws when `leaseMs` is not a positive finite number, or the write is not confirmed
     *
     * @returns whether `owner` now holds the claim
     */
    async tryClaim(
      owner: string,
      { leaseMs }: BackfillClaimOptions,
    ): Promise<boolean> {
      assertValidLeaseMs(leaseMs);

      const result = await client.$runCommandRaw({
        findAndModify: COLLECTION,
        query: {
          _id: JOB_ID,
          $expr: {
            $or: [
              { $eq: ['$status', 'requested'] },
              {
                $and: [
                  { $eq: ['$status', 'running'] },
                  {
                    $or: [
                      { $eq: ['$claimedBy', null] },
                      { $lt: ['$leaseExpiresAt', '$$NOW'] },
                    ],
                  },
                ],
              },
              {
                $and: [
                  { $eq: ['$status', 'failed'] },
                  // In `$expr` null and a missing field sort before every date, so a bare `$lte`
                  // would hand out a job whose retries are used up.
                  { $gt: ['$retryAt', null] },
                  { $lte: ['$retryAt', '$$NOW'] },
                ],
              },
            ],
          },
        },
        // A pipeline update, so the lease can be computed from `$$NOW`. `$literal` stops an
        // owner id starting with `$` from being read as a field path.
        update: [
          {
            $set: {
              stopRequested: {
                $cond: [
                  { $eq: ['$status', 'requested'] },
                  false,
                  '$stopRequested',
                ],
              },
              claimedBy: { $literal: owner },
              status: 'running',
              leaseExpiresAt: { $add: ['$$NOW', leaseMs] },
              retryAt: null,
            },
          },
        ],
      });
      throwOnWriteErrors(result, 'backfill job tryClaim');
      return result.value != null;
    },

    /**
     * Whether a run is outstanding: `requested`, `running`, or `failed` with a retry due.
     * False when the document is missing.
     */
    async isRunOutstanding(): Promise<boolean> {
      const result = await client.$runCommandRaw({
        find: COLLECTION,
        filter: RUN_OUTSTANDING_FILTER,
        projection: { _id: 1 },
        limit: 1,
      });
      const { firstBatch } = result.cursor as { firstBatch: unknown[] };
      return firstBatch.length > 0;
    },

    /**
     * The first claim of a run: store the cutoff and total resolved from the scope, reset the
     * progress fields and renew the lease.
     *
     * Like every write below, fenced in the filter itself on `owner` holding a `running` job, so
     * an owner that lost its claim cannot write; a refusal is returned, not thrown.
     *
     * @throws when `leaseMs` is not a positive finite number, or the write is not confirmed
     * @returns whether `owner` still held the claim and the write applied
     */
    async startRun(
      owner: string,
      { runCutoff, runTotal }: BackfillRunStart,
      { leaseMs }: BackfillClaimOptions,
    ): Promise<boolean> {
      assertValidLeaseMs(leaseMs);
      const value = await fencedWrite(owner, 'startRun', {
        runCutoff: toDate(runCutoff),
        runTotal,
        ...progressFields({
          progressMarker: null,
          processed: 0,
          skippedPages: 0,
        }),
        leaseExpiresAt: { $add: ['$$NOW', leaseMs] },
      });
      return value != null;
    },

    /**
     * Save the progress and renew the lease. Saved progress ends a run of failures, so the
     * failure count restarts here.
     *
     * @throws when `leaseMs` is not a positive finite number, or the write is not confirmed
     * @returns the admin-owned flags of the written document, or null when `owner` no longer
     *          holds the claim or the document is gone
     */
    async checkpoint(
      owner: string,
      progress: BackfillProgress,
      { leaseMs }: BackfillClaimOptions,
    ): Promise<BackfillCheckpointReply | null> {
      assertValidLeaseMs(leaseMs);
      const value = await fencedWrite(owner, 'checkpoint', {
        ...progressFields(progress),
        failedAttempts: 0,
        leaseExpiresAt: { $add: ['$$NOW', leaseMs] },
      });
      if (value == null) return null;
      return { stopRequested: value.stopRequested === true };
    },

    /** End the run on the admin's Stop, keeping the progress so Resume continues from it. */
    async finishStopped(
      owner: string,
      progress: BackfillProgress,
    ): Promise<boolean> {
      const value = await fencedWrite(owner, 'finishStopped', {
        ...progressFields(progress),
        ...settledEndingFields,
        status: 'stopped',
      });
      return value != null;
    },

    /** End the run with its walk exhausted, recording the coverage it reached. */
    async finishComplete(
      owner: string,
      progress: BackfillProgress,
      record: BackfillCoverageRecord,
    ): Promise<boolean> {
      const value = await fencedWrite(owner, 'finishComplete', {
        ...progressFields(progress),
        ...settledEndingFields,
        status: 'complete',
        coverage: record.coverage,
        coveredSince: toDate(
          record.coverage === 'partial' ? record.coveredSince : null,
        ),
        completedAt: '$$NOW',
        lastError: null,
      });
      return value != null;
    },

    /**
     * End the run on an error, count the failure, and schedule the retry: `retryAt` is the
     * delay for this many failures in a row from now, or null once they pass the cap or while a
     * Stop is pending, which leaves the job for the admin. The retry resumes from the marker
     * saved at the last checkpoint; the in-memory progress is not written, so pages skipped since
     * then are redone.
     *
     * @throws when a retry delay is not a positive finite number, or the write is not confirmed
     */
    async finishFailed(
      owner: string,
      lastError: string,
      { retryDelaysMs }: BackfillFailureOptions,
    ): Promise<boolean> {
      assertValidRetryDelays(retryDelaysMs);
      // One `$set` stage reads every field as it was before the write, so both fields start
      // from the stored count.
      const failuresInARow = {
        $add: [{ $ifNull: ['$failedAttempts', 0] }, 1],
      };
      const value = await fencedWrite(owner, 'finishFailed', {
        ...releaseClaimFields,
        status: 'failed',
        lastError: { $literal: lastError },
        failedAttempts: failuresInARow,
        retryAt: {
          $cond: [
            {
              $or: [
                { $eq: ['$stopRequested', true] },
                { $gt: [failuresInARow, retryDelaysMs.length] },
              ],
            },
            null,
            {
              $add: [
                '$$NOW',
                {
                  $arrayElemAt: [
                    { $literal: [...retryDelaysMs] },
                    { $subtract: [failuresInARow, 1] },
                  ],
                },
              ],
            },
          ],
        },
      });
      return value != null;
    },
  };
};
