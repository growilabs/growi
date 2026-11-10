import type { PrismaClient } from '~/generated/prisma/client';

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
//
// Returned as a model definition, not a `defineExtension` of its own: `page-link.ts` mounts it
// in its existing extension, because every extra `.$extends` in `utils/prisma.ts` lengthens
// the client type until `lint:typecheck` fails with TS2589 in unrelated files.
export const createPageLinkBackfillJobModel = (
  client: Pick<PrismaClient, '$runCommandRaw'>,
) => {
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
     * `running` / `failed` one that nobody holds or whose holder's lease has expired. An
     * `idle`, `stopped` or `complete` job is never handed out, so an admin's cancel or Stop
     * that lands between the caller's read and this call is not overridden.
     *
     * A claim clears any stale `stopRequested`, in the same write.
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
      if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
        throw new Error('leaseMs value is invalid');
      }

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
              stopRequested: false,
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
  };
};
