/* eslint-disable @typescript-eslint/no-explicit-any */

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
  ): Promise<IPageRedirectEndpoints>;
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

schema.statics.retrievePageRedirectEndpoints = async function (
  fromPath: string,
): Promise<IPageRedirectEndpoints | null> {
  const aggResult: IPageRedirectWithChains[] = await this.aggregate([
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
  const sortedChains = redirectWithChains[CHAINS_FIELD_NAME].sort(
    (a, b) => b[DEPTH_FIELD_NAME] - a[DEPTH_FIELD_NAME],
  );

  const start = {
    fromPath: redirectWithChains.fromPath,
    toPath: redirectWithChains.toPath,
  };
  const end = sortedChains.length === 0 ? start : sortedChains[0];

  return { start, end };
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
