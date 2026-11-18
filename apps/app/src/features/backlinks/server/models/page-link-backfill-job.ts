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

const assertValidLeaseMs = (leaseMs: number): void => {
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('leaseMs value is invalid');
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

/** Written by the endings that settle a Stop: the run is over, so a pending one is moot. */
const settledEndingFields = {
  ...releaseClaimFields,
  stopRequested: false,
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
     * Atomically claim the job for `owner`. Succeeds only for a `requested` job, or for a
     * `running` / `failed` one that nobody holds or whose holder's lease has expired. Any
     * other status is never handed out (rationale: design.md, "Stop and resume").
     *
     * A claim from `requested` clears any stale `stopRequested` in the same write; a take-over
     * of a `running` / `failed` job keeps it, so a live Stop is not lost.
     *
     * Expiry is judged on the database clock (`$$NOW`), so instances whose own clocks
     * disagree cannot steal a live claim from each other.
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
                  { $in: ['$status', ['running', 'failed']] },
                  {
                    $or: [
                      { $eq: ['$claimedBy', null] },
                      { $lt: ['$leaseExpiresAt', '$$NOW'] },
                    ],
                  },
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
            },
          },
        ],
      });
      throwOnWriteErrors(result, 'backfill job tryClaim');
      return result.value != null;
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
     * Save the progress and renew the lease.
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
     * End the run on an error. The claim is released, so the next idle tick claims the `failed`
     * job again and resumes from the marker saved at the last checkpoint; the in-memory progress
     * is not written, so pages skipped since then are redone. A pending Stop is kept: the retry
     * claim keeps it too (`tryClaim`), so the retry stops at its first checkpoint.
     */
    async finishFailed(owner: string, lastError: string): Promise<boolean> {
      const value = await fencedWrite(owner, 'finishFailed', {
        ...releaseClaimFields,
        status: 'failed',
        lastError: { $literal: lastError },
      });
      return value != null;
    },
  };
};
