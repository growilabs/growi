import type { IAttachment } from '@growi/core';
import { addSeconds } from 'date-fns/addSeconds';
import { type Document, type Model, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';
import path from 'path';

import loggerFactory from '~/utils/logger';

import { AttachmentType } from '../interfaces/attachment';
import { getOrCreateModel } from '../util/mongoose-utils';

// eslint-disable-next-line no-unused-vars
const logger = loggerFactory('growi:models:attachment');

function generateFileHash(fileName) {
  const hash = require('crypto').createHash('md5');
  hash.update(`${fileName}_${Date.now()}`);

  return hash.digest('hex');
}

type GetValidTemporaryUrl = () => string | null | undefined;
type CashTemporaryUrlByProvideSec = (
  temporaryUrl: string,
  lifetimeSec: number,
) => Promise<IAttachmentDocument>;

export interface IAttachmentDocument extends IAttachment, Document {
  getValidTemporaryUrl: GetValidTemporaryUrl;
  cashTemporaryUrlByProvideSec: CashTemporaryUrlByProvideSec;
}
export interface IAttachmentModel extends Model<IAttachmentDocument> {
  createWithoutSave: (
    pageId,
    user,
    originalName: string,
    fileFormat: string,
    fileSize: number,
    attachmentType: AttachmentType,
  ) => IAttachmentDocument;
}

const attachmentSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'Page', index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    filePath: { type: String }, // DEPRECATED: remains for backward compatibility for v3.3.x or below
    fileName: { type: String, required: true, unique: true },
    fileFormat: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    originalName: { type: String },
    temporaryUrlCached: { type: String },
    temporaryUrlExpiredAt: { type: Date },
    attachmentType: {
      type: String,
      enum: AttachmentType,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
attachmentSchema.plugin(uniqueValidator);
attachmentSchema.plugin(mongoosePaginate);

// virtual
attachmentSchema.virtual('filePathProxied').get(function () {
  return `/attachment/${this._id}`;
});

attachmentSchema.virtual('downloadPathProxied').get(function () {
  return `/download/${this._id}`;
});

attachmentSchema.set('toObject', { virtuals: true });
attachmentSchema.set('toJSON', { virtuals: true });

attachmentSchema.statics.createWithoutSave = function (
  pageId,
  user,
  originalName: string,
  fileFormat: string,
  fileSize: number,
  attachmentType: AttachmentType,
) {
  // biome-ignore lint/complexity/noUselessThisAlias: ignore
  const Attachment = this;

  const extname = path.extname(originalName);
  let fileName = generateFileHash(originalName);
  if (extname.length > 1) {
    // ignore if empty or '.' only
    fileName = `${fileName}${extname}`;
  }

  const attachment = new Attachment();
  attachment.page = pageId;
  attachment.creator = user._id;
  attachment.originalName = originalName;
  attachment.fileName = fileName;
  attachment.fileFormat = fileFormat;
  attachment.fileSize = fileSize;
  attachment.attachmentType = attachmentType;
  return attachment;
};

const getValidTemporaryUrl: GetValidTemporaryUrl = function (
  this: IAttachmentDocument,
) {
  if (this.temporaryUrlExpiredAt == null) {
    return null;
  }
  // return null when expired url
  if (this.temporaryUrlExpiredAt.getTime() < new Date().getTime()) {
    return null;
  }
  return this.temporaryUrlCached;
};
attachmentSchema.methods.getValidTemporaryUrl = getValidTemporaryUrl;

const cashTemporaryUrlByProvideSec: CashTemporaryUrlByProvideSec = function (
  this: IAttachmentDocument,
  temporaryUrl,
  lifetimeSec,
) {
  if (temporaryUrl == null) {
    throw new Error('url is required.');
  }
  this.temporaryUrlCached = temporaryUrl;
  this.temporaryUrlExpiredAt = addSeconds(new Date(), lifetimeSec);

  return this.save();
};
attachmentSchema.methods.cashTemporaryUrlByProvideSec =
  cashTemporaryUrlByProvideSec;

export const Attachment = getOrCreateModel<
  IAttachmentDocument,
  IAttachmentModel
>('Attachment', attachmentSchema);
