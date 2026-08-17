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

          const aggResult = (await context.aggregateRaw({
            pipeline: [
              { $match: { fromPath } },
              {
                $graphLookup: {
                  from: 'pageredirects',
                  startWith: '$toPath',
                  connectFromField: 'toPath',
                  connectToField: 'fromPath',
                  as: CHAINS_FIELD_NAME,
                  depthField: DEPTH_FIELD_NAME,
                },
              },
            ],
          })) as unknown as RawPageRedirectWithDepthChains[];

          if (aggResult.length === 0) {
            return null;
          }

          if (aggResult.length > 1) {
            logger.warn(
              `Although two or more PageRedirect documents starts from '${fromPath}' exists, The first one is used.`,
            );
          }

          const redirectWithChains = aggResult[0];

          // sort chains in desc
          const sortedChains = [...redirectWithChains[CHAINS_FIELD_NAME]].sort(
            (a, b) =>
              toDepthNumber(b[DEPTH_FIELD_NAME]) -
              toDepthNumber(a[DEPTH_FIELD_NAME]),
          );

          const start = {
            fromPath: redirectWithChains.fromPath,
            toPath: redirectWithChains.toPath,
          };
          const end = sortedChains.length === 0 ? start : sortedChains[0];

          return { start, end };
        },

        deleteByFromPath(fromPath: string): Promise<{ count: number }> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);
          return context.deleteMany({ where: { fromPath } });
        },

        async removePageRedirectsByToPath(toPath: string): Promise<void> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);

          const aggResult = (await context.aggregateRaw({
            pipeline: [
              { $match: { toPath } },
              {
                $graphLookup: {
                  from: 'pageredirects',
                  startWith: '$fromPath',
                  connectFromField: 'fromPath',
                  connectToField: 'toPath',
                  as: CHAINS_FIELD_NAME,
                },
              },
            ],
          })) as unknown as RawPageRedirectWithChains[];

          if (aggResult.length === 0) {
            return;
          }

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

        // Deliberately one `create` per document instead of a single
        // `createMany`: callers insert page-redirect rows for a batch of
        // renamed/deleted pages and must tolerate an individual
        // fromPath-uniqueness collision without losing the rest of the batch
        // (mirrors the pre-migration `bulkWrite` duplicate-tolerant intent
        // for this collection). Prisma's MongoDB connector has no
        // `skipDuplicates` on `createMany`, so `Promise.allSettled` + a
        // P2002-only tolerance check is used instead (same pattern as
        // `pagetagrelations`/`duplicateTags` in service/page/index.ts).
        async createManyIgnoringDuplicates(
          documents: IPageRedirect[],
        ): Promise<void> {
          const context =
            Prisma.getExtensionContext<typeof prisma.pageredirects>(this);

          const results = await Promise.allSettled(
            documents.map((data) => context.create({ data })),
          );

          const unexpectedFailure = results.find(
            (result): result is PromiseRejectedResult =>
              result.status === 'rejected' &&
              !(
                result.reason instanceof Prisma.PrismaClientKnownRequestError &&
                result.reason.code === 'P2002'
              ),
          );
          if (unexpectedFailure != null) {
            throw new Error(
              `Failed to create PageRedirect documents: ${unexpectedFailure.reason}`,
            );
          }
        },
      },
    },
  });
});
