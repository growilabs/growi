import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type {
  INewsReadStatus,
  INewsReadStatusHasId,
} from '../../interfaces/news-read-status';

export interface NewsReadStatusDocument extends INewsReadStatus, Document {
  _id: Types.ObjectId;
}

export interface NewsReadStatusModel extends Model<NewsReadStatusDocument> {}

const NewsReadStatusSchema = new Schema<
  NewsReadStatusDocument,
  NewsReadStatusModel
>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  newsItemId: {
    type: Schema.Types.ObjectId,
    ref: 'NewsItem',
    required: true,
  },
  readAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
});

NewsReadStatusSchema.index({ userId: 1, newsItemId: 1 }, { unique: true });

export const NewsReadStatus = getOrCreateModel<
  INewsReadStatusHasId,
  NewsReadStatusModel
>('NewsReadStatus', NewsReadStatusSchema);
