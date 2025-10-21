import type { IGrantedGroup } from '@growi/core';
import { GroupType } from '@growi/core';
import { addSeconds } from 'date-fns/addSeconds';
import type { Document, FilterQuery, Model, QueryOptions } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

import type { IOptionsForCreate, IOptionsForUpdate } from '~/interfaces/page';
import { PageActionStage, PageActionType } from '~/interfaces/page-operation';

import loggerFactory from '../../utils/logger';
import type { ObjectIdLike } from '../interfaces/mongoose-utils';
import { getOrCreateModel } from '../util/mongoose-utils';

const TIME_TO_ADD_SEC = 10;

const logger = loggerFactory('growi:models:page-operation');

const ObjectId = mongoose.Schema.Types.ObjectId;

type IPageForResuming = {
  _id: ObjectIdLike;
  path: string;
  isEmpty: boolean;
  parent?: ObjectIdLike;
  grant?: number;
  grantedUsers?: ObjectIdLike[];
  grantedGroups: IGrantedGroup[];
  descendantCount: number;
  status?: number;
  revision?: ObjectIdLike;
  lastUpdateUser?: ObjectIdLike;
  creator?: ObjectIdLike;
};

type IUserForResuming = {
  _id: ObjectIdLike;
};

type IOptionsForResuming = {
  format: 'md' | 'pdf';
  updateMetadata?: boolean;
  createRedirectPage?: boolean;
  prevDescendantCount?: number;
} & IOptionsForUpdate &
  IOptionsForCreate;

/*
 * Main Schema
 */
export interface IPageOperation {
  actionType: PageActionType;
  actionStage: PageActionStage;
  fromPath: string;
  toPath?: string;
  page: IPageForResuming;
  user: IUserForResuming;
  options?: IOptionsForResuming;
  incForUpdatingDescendantCount?: number;
  unprocessableExpiryDate: Date;
  exPage?: IPageForResuming;

  isProcessable(): boolean;
}

export interface PageOperationDocument extends IPageOperation, Document {}

export type PageOperationDocumentHasId = PageOperationDocument & {
  _id: ObjectIdLike;
};

export interface PageOperationModel extends Model<PageOperationDocument> {
  findByIdAndUpdatePageActionStage(
    pageOpId: ObjectIdLike,
    stage: PageActionStage,
  ): Promise<PageOperationDocumentHasId | null>;
  findMainOps(
    filter?: FilterQuery<PageOperationDocument>,
    projection?: any,
    options?: QueryOptions,
  ): Promise<PageOperationDocumentHasId[]>;
  deleteByActionTypes(deleteTypeList: PageActionType[]): Promise<void>;
  extendExpiryDate(operationId: ObjectIdLike): Promise<void>;
}

const pageSchemaForResuming = new Schema<IPageForResuming>({
  _id: { type: ObjectId, ref: 'Page', index: true },
  parent: { type: ObjectId, ref: 'Page' },
  descendantCount: { type: Number },
  isEmpty: { type: Boolean },
  path: { type: String, required: true, index: true },
  revision: { type: ObjectId, ref: 'Revision' },
  status: { type: String },
  grant: { type: Number },
  grantedUsers: [{ type: ObjectId, ref: 'User' }],
  grantedGroups: [
    {
      type: {
        type: String,
        enum: Object.values(GroupType),
        required: true,
        default: 'UserGroup',
      },
      item: {
        type: ObjectId,
        refPath: 'grantedGroups.type',
        required: true,
      },
    },
  ],
  creator: { type: ObjectId, ref: 'User' },
  lastUpdateUser: { type: ObjectId, ref: 'User' },
});

const userSchemaForResuming = new Schema<IUserForResuming>({
  _id: { type: ObjectId, ref: 'User', required: true },
});

const optionsSchemaForResuming = new Schema<IOptionsForResuming>(
  {
    createRedirectPage: { type: Boolean },
    updateMetadata: { type: Boolean },
    prevDescendantCount: { type: Number },
    grant: { type: Number },
    grantUserGroupIds: [
      {
        type: {
          type: String,
          enum: Object.values(GroupType),
          required: true,
          default: 'UserGroup',
        },
        item: {
          type: ObjectId,
          refPath: 'grantedGroups.type',
          required: true,
        },
      },
    ],
    format: { type: String },
    overwriteScopesOfDescendants: { type: Boolean },
  },
  { _id: false },
);

const schema = new Schema<PageOperationDocument, PageOperationModel>({
  actionType: {
    type: String,
    enum: PageActionType,
    required: true,
    index: true,
  },
  actionStage: {
    type: String,
    enum: PageActionStage,
    required: true,
    index: true,
  },
  fromPath: { type: String, required: true, index: true },
  toPath: { type: String, index: true },
  page: { type: pageSchemaForResuming, required: true },
  exPage: { type: pageSchemaForResuming, required: false },
  user: { type: userSchemaForResuming, required: true },
  options: { type: optionsSchemaForResuming },
  incForUpdatingDescendantCount: { type: Number },
  unprocessableExpiryDate: {
    type: Date,
    default: () => addSeconds(new Date(), 10),
  },
});

schema.statics.findByIdAndUpdatePageActionStage = async function (
  pageOpId: ObjectIdLike,
  stage: PageActionStage,
): Promise<PageOperationDocumentHasId | null> {
  return this.findByIdAndUpdate(
    pageOpId,
    {
      $set: { actionStage: stage },
    },
    { new: true },
  );
};

schema.statics.findMainOps = async function (
  filter?: FilterQuery<PageOperationDocument>,
  projection?: any,
  options?: QueryOptions,
): Promise<PageOperationDocumentHasId[]> {
  return this.find(
    { ...filter, actionStage: PageActionStage.Main },
    projection,
    options,
  );
};

schema.statics.deleteByActionTypes = async function (
  actionTypes: PageActionType[],
): Promise<void> {
  await this.deleteMany({ actionType: { $in: actionTypes } });
  logger.info(
    `Deleted all PageOperation documents with actionType: [${actionTypes}]`,
  );
};

/**
 * add TIME_TO_ADD_SEC to current time and update unprocessableExpiryDate with it
 */
schema.statics.extendExpiryDate = async function (
  operationId: ObjectIdLike,
): Promise<void> {
  const date = addSeconds(new Date(), TIME_TO_ADD_SEC);
  await this.findByIdAndUpdate(operationId, { unprocessableExpiryDate: date });
};

schema.methods.isProcessable = function (): boolean {
  const { unprocessableExpiryDate } = this;
  return (
    unprocessableExpiryDate == null ||
    (unprocessableExpiryDate != null && new Date() > unprocessableExpiryDate)
  );
};

export default getOrCreateModel<PageOperationDocument, PageOperationModel>(
  'PageOperation',
  schema,
);
