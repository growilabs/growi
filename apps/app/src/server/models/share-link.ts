import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import type { IShareLink } from '~/interfaces/share-link';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface ShareLinkDocument extends IShareLink, Document {
  isExpired: () => boolean;
}

export type ShareLinkModel = Model<ShareLinkDocument>;

/*
 * define schema
 */
const schema = new Schema<ShareLinkDocument, ShareLinkModel>(
  {
    relatedPage: {
      type: Schema.Types.ObjectId,
      ref: 'Page',
      required: true,
      index: true,
    },
    expiredAt: { type: Date },
    description: { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
schema.plugin(mongoosePaginate);
schema.plugin(uniqueValidator);

schema.methods.isExpired = function () {
  if (this.expiredAt == null) {
    return false;
  }
  return this.expiredAt.getTime() < new Date().getTime();
};

export default getOrCreateModel<ShareLinkDocument, ShareLinkModel>(
  'ShareLink',
  schema,
);
