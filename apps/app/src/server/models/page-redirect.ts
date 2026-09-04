import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import loggerFactory from '~/utils/logger';

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

export interface PageRedirectDocument extends IPageRedirect, Document {}

export interface PageRedirectModel extends Model<PageRedirectDocument> {
  retrievePageRedirectEndpoints(
    fromPath: string,
  ): Promise<IPageRedirectEndpoints | null>;
  retrievePageRedirectEndpointsBatch(
    fromPaths: string[],
    maxDepth?: number,
  ): Promise<Map<string, IPageRedirectEndpoints>>;
  retrieveFromPathsRedirectingTo(
    toPath: string,
    maxDepth?: number,
  ): Promise<string[]>;
  removePageRedirectsByToPath(toPath: string): Promise<void>;
}

const CHAINS_FIELD_NAME = 'chains';
const DEPTH_FIELD_NAME = 'depth';

type IPageRedirectWithChains = PageRedirectDocument & {
  [CHAINS_FIELD_NAME]: (PageRedirectDocument & {
    [DEPTH_FIELD_NAME]: number;
  })[];
};

const schema = new Schema<PageRedirectDocument, PageRedirectModel>({
  fromPath: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  toPath: { type: String, required: true },
});

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
schema.statics.retrievePageRedirectEndpointsBatch = async function (
  fromPaths: string[],
  maxDepth?: number,
): Promise<Map<string, IPageRedirectEndpoints>> {
  if (fromPaths.length === 0) {
    return new Map();
  }

  const aggResult: IPageRedirectWithChains[] = await this.aggregate([
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
  ]);
  /* ---------- aggResult example ----------
  {
    "_id" : ObjectId("62e5650d6134d37aa0935e6d"),
    "fromPath" : "/page1",
    "toPath" : "/page2",
    "chains" : [
        {
            "_id" : ObjectId("62e5651b6134d37aa0935e7a"),
            "fromPath" : "/page2",
            "toPath" : "/page3",
            "depth" : NumberLong(0)
        },
        {
            "_id" : ObjectId("62e565256134d37aa0935e80"),
            "fromPath" : "/page3",
            "toPath" : "/Sandbox",
            "depth" : NumberLong(1)
        }
    ]
  }
  */

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
      (a, b) => b[DEPTH_FIELD_NAME] - a[DEPTH_FIELD_NAME],
    );

    const end = sortedChains.length === 0 ? start : sortedChains[0];

    endpointsByFromPath.set(start.fromPath, { start, end });
  }

  return endpointsByFromPath;
};

schema.statics.retrievePageRedirectEndpoints = async function (
  fromPath: string,
): Promise<IPageRedirectEndpoints | null> {
  const endpoint = await this.retrievePageRedirectEndpointsBatch([fromPath]);
  return endpoint.get(fromPath) ?? null;
};

/**
 * One reverse walk: every redirect whose chain reaches `toPath`, at any depth.
 *
 * The mirror of the `retrievePageRedirectEndpointsBatch` pipeline — that walks
 * forward from a path to where its chain ends, this walks back from a path to
 * everything that reaches it. Shared so the two callers below cannot drift, each
 * projecting what it needs from the same documents.
 */
const aggregateRedirectsReaching = async (
  model: PageRedirectModel,
  toPath: string,
  maxDepth?: number,
): Promise<IPageRedirectWithChains[]> =>
  await model.aggregate([
    { $match: { toPath } },
    {
      $graphLookup: {
        from: 'pageredirects',
        startWith: '$fromPath',
        connectFromField: 'fromPath',
        connectToField: 'toPath',
        as: CHAINS_FIELD_NAME,
        depthField: DEPTH_FIELD_NAME,
        ...(maxDepth != null ? { maxDepth } : {}),
      },
    },
  ]);

/**
 * Resolves every `fromPath` whose redirect chain reaches `toPath`.
 *
 * The result is **candidates only** — a longer chain can carry a candidate past
 * `toPath`, so only the forward walk can say where one actually resolves.
 *
 * @param maxDepth - As on `retrievePageRedirectEndpointsBatch`: a cap the caller
 *                   chooses, omitted to walk every chain to its real start.
 */
schema.statics.retrieveFromPathsRedirectingTo = async function (
  toPath: string,
  maxDepth?: number,
): Promise<string[]> {
  const aggResult = await aggregateRedirectsReaching(this, toPath, maxDepth);

  return [
    ...new Set(
      aggResult.flatMap((redirectWithChains) => [
        redirectWithChains.fromPath,
        ...redirectWithChains[CHAINS_FIELD_NAME].map((doc) => doc.fromPath),
      ]),
    ),
  ];
};

schema.statics.removePageRedirectsByToPath = async function (
  toPath: string,
): Promise<void> {
  const aggResult = await aggregateRedirectsReaching(this, toPath);
  if (aggResult.length === 0) {
    return;
  }

  // By `_id`, not `fromPath`: where the unique index build failed, two documents
  // can share a `fromPath` while pointing at different targets, and only the one
  // this walk reached should go.
  const idsToRemove = aggResult.flatMap((redirectWithChains) => [
    redirectWithChains._id,
    ...redirectWithChains[CHAINS_FIELD_NAME].map((doc) => doc._id),
  ]);

  await this.deleteMany({ _id: { $in: idsToRemove } });
};

export default getOrCreateModel<PageRedirectDocument, PageRedirectModel>(
  'PageRedirect',
  schema,
);
