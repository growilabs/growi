/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import type { INamedQuery } from '~/interfaces/named-query';
import { SearchDelegatorName } from '~/interfaces/named-query';

import loggerFactory from '../../utils/logger';
import { getOrCreateModel } from '../util/mongoose-utils';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = loggerFactory('growi:models:named-query');

export interface NamedQueryDocument extends INamedQuery, Document {}

export type NamedQueryModel = Model<NamedQueryDocument>;

const schema = new Schema<NamedQueryDocument, NamedQueryModel>({
  name: { type: String, required: true, unique: true },
  aliasOf: { type: String },
  delegatorName: { type: String, enum: SearchDelegatorName },
  creator: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    default: null,
  },
});

schema.pre('validate', async function (this, next) {
  if (this.aliasOf == null && this.delegatorName == null) {
    throw Error('Either of aliasOf and delegatorNameName must not be null.');
  }

  next();
});

export default getOrCreateModel<NamedQueryDocument, NamedQueryModel>(
  'NamedQuery',
  schema,
);
