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

schema.statics.removePageRedirectsByToPath = async function (
  toPath: string,
): Promise<void> {
  const aggResult: IPageRedirectWithChains[] = await this.aggregate([
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
  ]);
  /* ---------- aggResult example ----------
  // 1
  {
    "_id" : ObjectId("62e565256134d37aa0935e80"),
    "fromPath" : "/page3",
    "toPath" : "/page4",
    "chains" : [
        {
            "_id" : ObjectId("62e5651b6134d37aa0935e7a"),
            "fromPath" : "/page2",
            "toPath" : "/page3",
            "depth" : NumberLong(0)
        },
        {
            "_id" : ObjectId("62e5650d6134d37aa0935e6d"),
            "fromPath" : "/page1",
            "toPath" : "/page2",
            "depth" : NumberLong(1)
        }
    ]
  }
  // 2
  {
    "_id" : ObjectId("62e5937a6134d37aa0936405"),
    "fromPath" : "/org/page4",
    "toPath" : "/page4",
    "chains" : []
  }
  */

  if (aggResult.length === 0) {
    return;
  }

  const idsToRemove = aggResult.flatMap((redirectWithChains) => {
    return [
      redirectWithChains._id,
      redirectWithChains[CHAINS_FIELD_NAME].map((doc) => doc._id),
    ].flat();
  });

  await this.deleteMany({ _id: { $in: idsToRemove } });
  return;
};

export default getOrCreateModel<PageRedirectDocument, PageRedirectModel>(
  'PageRedirect',
  schema,
);
