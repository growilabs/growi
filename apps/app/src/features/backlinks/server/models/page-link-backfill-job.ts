import { Prisma } from '~/generated/prisma/client';

import { throwOnWriteErrors } from './throw-on-write-errors';

const COLLECTION = 'pagelinkbackfilljobs';

// The one control document is addressed by a fixed `_id`, so concurrent boots cannot create a
// second one and no unique index (and so no migration) is needed.
const JOB_ID = { $oid: '000000000000000000000001' };

export interface BackfillClaimOptions {
  /** How long the claim stays valid without a renewal. */
  readonly leaseMs: number;
}

// Raw commands, not the query API: Prisma's `upsert` has no `$setOnInsert`, and `update`
// injects a `v` increment this v-less collection does not have.
export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    model: {
      pagelinkbackfilljobs: {
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
         * Atomically claim the job for `owner`. Succeeds when nobody holds it or the holder's
         * lease has expired, and never for a completed job.
         *
         * Expiry is judged on the database clock (`$$NOW`), so instances whose own clocks
         * disagree cannot steal a live claim from each other.
         *
         * Does not evaluate the start rule — that is the caller's job.
         *
         * @returns whether `owner` now holds the claim
         */
        async tryClaim(
          owner: string,
          { leaseMs }: BackfillClaimOptions,
        ): Promise<boolean> {
          const result = await client.$runCommandRaw({
            findAndModify: COLLECTION,
            query: {
              _id: JOB_ID,
              status: { $ne: 'complete' },
              $expr: {
                $or: [
                  { $eq: ['$claimedBy', null] },
                  { $lt: ['$leaseExpiresAt', '$$NOW'] },
                ],
              },
            },
            // A pipeline update, so the lease can be computed from `$$NOW`. `$literal` stops an
            // owner id starting with `$` from being read as a field path.
            update: [
              {
                $set: {
                  claimedBy: { $literal: owner },
                  status: 'running',
                  leaseExpiresAt: { $add: ['$$NOW', leaseMs] },
                },
              },
            ],
          });
          return result.value != null;
        },
      },
    },
  });
});
