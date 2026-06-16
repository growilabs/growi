import type { Types } from 'mongoose';
import { Schema } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IConfig {
  _id: Types.ObjectId;
  ns: string;
  key: string;
  value: string;
  createdAt: Date;
}

const schema = new Schema<IConfig>(
  {
    ns: { type: String },
    key: { type: String, required: true, unique: true },
    value: { type: String, required: true },
  },
  {
    timestamps: true,
  },
);

schema.plugin(uniqueValidator);

export const Config = getOrCreateModel<IConfig, Record<string, never>>(
  'Config',
  schema,
);
