import { allOrigin } from '@growi/core';
import type {
  HasObjectId,
  IRevision,
  Origin,
} from '@growi/core/dist/interfaces';
import type { Types } from 'mongoose';
import {
  Schema, type Document, type Model,
} from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import loggerFactory from '~/utils/logger';

import { getOrCreateModel } from '../util/mongoose-utils';

import type { PageDocument } from './page';

const logger = loggerFactory('growi:models:revision');


export interface IRevisionDocument extends IRevision, Document {
}

type UpdateRevisionListByPageId = (pageId: Types.ObjectId, updateData: Partial<IRevision>) => Promise<void>;
type PrepareRevision = (
  pageData: PageDocument, body: string, previousBody: string | null, user: HasObjectId, origin?: Origin, options?: { format: string }
) => IRevisionDocument;

export interface IRevisionModel extends Model<IRevisionDocument> {
  updateRevisionListByPageId: UpdateRevisionListByPageId,
  prepareRevision: PrepareRevision,
}

// Use this to allow empty strings to pass the `required` validator
Schema.Types.String.checkRequired(v => typeof v === 'string');

const revisionSchema = new Schema<IRevisionDocument, IRevisionModel>({
  // The type of pageId is always converted to String at server startup
  // Refer to this method (/src/server/service/normalize-data/convert-revision-page-id-to-string.ts) to change the pageId type
  pageId: {
    type: Schema.Types.ObjectId, ref: 'Page', required: true, index: true,
  },
  body: {
    type: String,
    required: true,
    get: (data) => {
    // replace CR/CRLF to LF above v3.1.5
    // see https://github.com/growilabs/growi/issues/463
      return data ? data.replace(/\r\n?/g, '\n') : '';
    },
  },
  format: { type: String, default: 'markdown' },
  author: { type: Schema.Types.ObjectId, ref: 'User' },
  hasDiffToPrev: { type: Boolean },
  origin: { type: String, enum: allOrigin },
}, {
  timestamps: { createdAt: true, updatedAt: false },
});
revisionSchema.plugin(mongoosePaginate);

const updateRevisionListByPageId: UpdateRevisionListByPageId = async function(this: IRevisionModel, pageId, updateData) {
  // Check pageId for safety
  if (pageId == null) {
    throw new Error('Error: pageId is required');
  }
  await this.updateMany({ pageId }, { $set: updateData });
};
revisionSchema.statics.updateRevisionListByPageId = updateRevisionListByPageId;

const prepareRevision: PrepareRevision = function(this: IRevisionModel, pageData, body, previousBody, user, origin, options = { format: 'markdown' }) {
  if (user._id == null) {
    throw new Error('user should have _id');
  }
  if (pageData._id == null) {
    throw new Error('pageData should have _id');
  }

  const newRevision = new this();
  newRevision.pageId = pageData._id;
  newRevision.body = body;
  newRevision.format = options.format;
  newRevision.author = user._id;
  newRevision.origin = origin;
  if (pageData.revision != null) {
    newRevision.hasDiffToPrev = body !== previousBody;
  }

  return newRevision;
};
revisionSchema.statics.prepareRevision = prepareRevision;

export const Revision = getOrCreateModel<IRevisionDocument, IRevisionModel>('Revision', revisionSchema);
