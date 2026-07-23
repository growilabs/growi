import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { INewsItem, INewsItemHasId } from '../../interfaces/news-item';

// 90 days in seconds
const TTL_90_DAYS = 60 * 60 * 24 * 90;

export interface NewsItemDocument extends INewsItem, Document {
  _id: Types.ObjectId;
}

export interface NewsItemModel extends Model<NewsItemDocument> {}

const NewsItemSchema = new Schema<NewsItemDocument, NewsItemModel>({
  externalId: {
    type: String,
    required: true,
    unique: true,
  },
  title: {
    type: Map,
    of: String,
    required: true,
  },
  body: {
    type: Map,
    of: String,
  },
  emoji: {
    type: String,
  },
  url: {
    type: String,
  },
  image: {
    // Single nested schema: `_id: false` prevents an unwanted subdocument _id,
    // `default: undefined` prevents Mongoose from materializing an empty {}
    // on items that have no image.
    type: new Schema(
      {
        url: { type: String, required: true },
        alt: { type: Map, of: String },
      },
      { _id: false },
    ),
    default: undefined,
  },
  publishedAt: {
    type: Date,
    required: true,
    index: true,
  },
  fetchedAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: TTL_90_DAYS },
  },
  conditions: {
    targetRoles: [{ type: String }],
  },
});

export const NewsItem = getOrCreateModel<INewsItemHasId, NewsItemModel>(
  'NewsItem',
  NewsItemSchema,
);
