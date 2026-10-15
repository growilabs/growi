import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import { getOrCreateModel } from '../util/mongoose-utils';

const logger = loggerFactory('growi:models:page-redirects');

export type IPageRedirect = {
  fromPath: string;
  toPath: string;
};

export type IPageRedirectEndpoints = {
  start: IPageRedirect;
  end: IPageRedirect;
};

const CHAINS_FIELD_NAME = 'chains';
const DEPTH_FIELD_NAME = 'depth';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const schema = new Schema({
  fromPath: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  toPath: { type: String, required: true },
});

getOrCreateModel('PageRedirect', schema);

// aggregateRaw() serializes documents as MongoDB Extended JSON, not plain JS
// values (ObjectId -> { $oid }, and $graphLookup's `depthField` -> a 64-bit
// long, which may come back as a plain number or as { $numberLong }) -- these
// mirror the raw shape of a $graphLookup row over `pageredirects`.
type RawPageRedirectRow = {
  _id: { $oid: string };
  fromPath: string;
  toPath: string;
};
type RawLong = number | { $numberLong: string };
type RawPageRedirectWithDepthChains = RawPageRedirectRow & {
  [CHAINS_FIELD_NAME]: (RawPageRedirectRow & {
    [DEPTH_FIELD_NAME]: RawLong;
  })[];
};
type RawPageRedirectWithChains = RawPageRedirectRow & {
  [CHAINS_FIELD_NAME]: RawPageRedirectRow[];
};

function toDepthNumber(value: RawLong): number {
  return typeof value === 'number' ? value : Number(value.$numberLong);
}

// shape of the MongoDB `insert` command response
// (https://www.mongodb.com/docs/manual/reference/command/insert/)
type RawInsertCommandResult = {
  writeErrors?: { index: number; code: number; errmsg: string }[];
};
const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

type PageRedirectsContext = typeof prisma.pageredirects;

/**
 * Resolves the endpoint of each requested `fromPath`'s redirect chain.
 *
 * @param maxDepth - Optional cap on how many hops of a chain to walk. `$graphLookup`
 *                   is memory-bound (100MB, with no spill to disk), so a caller on a
 *                   hot path can trade reach for a guaranteed bound. Omit it to walk
 *                   each chain to its real end — page view resolves an old URL
 *                   through this, where a cap would turn a page that was renamed
 *                   many times into a not-found for that URL.
 */
const retrieveEndpointsBatch = async (
  context: PageRedirectsContext,
  fromPaths: string[],
  maxDepth?: number,
): Promise<Map<string, IPageRedirectEndpoints>> => {
  if (fromPaths.length === 0) {
    return new Map();
  }

  const aggResult = (await context.aggregateRaw({
    pipeline: [
      { $match: { fromPath: { $in: fromPaths } } },
      {
        $graphLookup: {
          from: 'pageredirects',
          startWith: '$toPath',
          connectFromField: 'toPath',
          connectToField: 'fromPath',
          as: CHAINS_FIELD_NAME,
          depthField: DEPTH_FIELD_NAME,
          ...(maxDepth != null ? { maxDepth } : {}),
        },
      },
    ],
  })) as unknown as RawPageRedirectWithDepthChains[];

  const endpointsByFromPath = new Map<string, IPageRedirectEndpoints>();

  for (const redirectWithChains of aggResult) {
    const start = {
      fromPath: redirectWithChains.fromPath,
      toPath: redirectWithChains.toPath,
    };

    // `fromPath` is unique-indexed, but MongoDB refuses to build a unique index
    // over a collection that already holds duplicates and the app boots anyway,
    // so duplicates are reachable. Take the first match instead of letting
    // aggregation order — which is not guaranteed — pick the winner.
    if (endpointsByFromPath.has(start.fromPath)) {
      logger.warn(
        `Although two or more PageRedirect documents starts from '${start.fromPath}' exists, The first one is used.`,
      );
      continue;
    }

    // sort chains in desc, without reordering the aggregation result itself
    const sortedChains = [...redirectWithChains[CHAINS_FIELD_NAME]].sort(
      (a, b) =>
        toDepthNumber(b[DEPTH_FIELD_NAME]) - toDepthNumber(a[DEPTH_FIELD_NAME]),
    );

    const end = sortedChains.length === 0 ? start : sortedChains[0];

    endpointsByFromPath.set(start.fromPath, { start, end });
  }

  return endpointsByFromPath;
};

/**
 * One reverse walk: every redirect whose chain reaches `toPath`, at any depth.
 *
 * The mirror of `retrieveEndpointsBatch` — that walks forward from a path to
 * where its chain ends, this walks back from a path to everything that reaches
 * it. Shared so the two callers below cannot drift, each projecting what it
 * needs from the same documents.
 */
const aggregateRedirectsReaching = async (
  context: PageRedirectsContext,
  toPath: string,
  maxDepth?: number,
): Promise<RawPageRedirectWithChains[]> =>
  (await context.aggregateRaw({
    pipeline: [
      { $match: { toPath } },
      {
        $graphLookup: {
          from: 'pageredirects',
          startWith: '$fromPath',
          connectFromField: 'fromPath',
          connectToField: 'toPath',
          as: CHAINS_FIELD_NAME,
          ...(maxDepth != null ? { maxDepth } : {}),
        },
      },
    ],
  })) as unknown as RawPageRedirectWithChains[];

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      pageredirects: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
    model: {
      pageredirects: {
        async retrievePageRedirectEndpoints(
          fromPath: string,
        ): Promise<IPageRedirectEndpoints | null> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);
          const endpoints = await retrieveEndpointsBatch(context, [fromPath]);
          return endpoints.get(fromPath) ?? null;
        },

        retrievePageRedirectEndpointsBatch(
          fromPaths: string[],
          maxDepth?: number,
        ): Promise<Map<string, IPageRedirectEndpoints>> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);
          return retrieveEndpointsBatch(context, fromPaths, maxDepth);
        },

        /**
         * Resolves every `fromPath` whose redirect chain reaches `toPath`.
         *
         * The result is **candidates only** — a longer chain can carry a candidate past
         * `toPath`, so only the forward walk can say where one actually resolves.
         *
         * @param maxDepth - As on `retrievePageRedirectEndpointsBatch`: a cap the caller
         *                   chooses, omitted to walk every chain to its real start.
         */
        async retrieveFromPathsRedirectingTo(
          toPath: string,
          maxDepth?: number,
        ): Promise<string[]> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);
          const aggResult = await aggregateRedirectsReaching(
            context,
            toPath,
            maxDepth,
          );

          return [
            ...new Set(
              aggResult.flatMap((redirectWithChains) => [
                redirectWithChains.fromPath,
                ...redirectWithChains[CHAINS_FIELD_NAME].map(
                  (doc) => doc.fromPath,
                ),
              ]),
            ),
          ];
        },

        deleteByFromPath(fromPath: string): Promise<{ count: number }> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);
          return context.deleteMany({ where: { fromPath } });
        },

        async removePageRedirectsByToPath(toPath: string): Promise<void> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);

          const aggResult = await aggregateRedirectsReaching(context, toPath);

          if (aggResult.length === 0) {
            return;
          }

          // By `_id`, not `fromPath`: where the unique index build failed, two documents
          // can share a `fromPath` while pointing at different targets, and only the one
          // this walk reached should go.
          const idsToRemove = aggResult.flatMap((redirectWithChains) => {
            return [
              redirectWithChains._id.$oid,
              ...redirectWithChains[CHAINS_FIELD_NAME].map(
                (doc) => doc._id.$oid,
              ),
            ];
          });

          await context.deleteMany({ where: { id: { in: idsToRemove } } });
        },

        // Callers insert page-redirect rows for a batch of renamed/deleted
        // pages (up to ~100 at a time) and must tolerate an individual
        // fromPath-uniqueness collision without losing the rest of the
        // batch (mirrors the pre-migration `bulkWrite` duplicate-tolerant
        // intent for this collection). Prisma's MongoDB connector has no
        // `skipDuplicates` on `createMany`, and issuing one `create()` per
        // document via `Promise.allSettled` would fire the whole batch as
        // concurrent individual writes (up to ~5,000 round trips for a
        // 5,000-page subtree, vs. ~50 before the Prisma migration), risking
        // connection-pool exhaustion. Instead, send the whole batch as a
        // single raw MongoDB `insert` command with `ordered: false`, which
        // keeps it to one round trip and lets MongoDB itself skip duplicate
        // keys while inserting the rest (same pattern as the raw `bulkWrite`
        // in migrations/20220131001218-*.js, and the `$runCommandRaw` usage
        // in bookmark-folder.ts).
        async createManyIgnoringDuplicates(
          documents: IPageRedirect[],
        ): Promise<void> {
          if (documents.length === 0) {
            return;
          }

          const result = (await client.$runCommandRaw({
            insert: 'pageredirects',
            documents: documents.map((data) => ({ ...data, __v: 0 })),
            ordered: false,
          })) as unknown as RawInsertCommandResult;

          const unexpectedFailure = result.writeErrors?.find(
            (writeError) => writeError.code !== MONGO_DUPLICATE_KEY_ERROR_CODE,
          );
          if (unexpectedFailure != null) {
            throw new Error(
              `Failed to create PageRedirect documents: ${unexpectedFailure.errmsg}`,
            );
          }
        },
      },
    },
  });
});
