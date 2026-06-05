import type { Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IChangeStreamResumeToken {
  key: string;
  token: unknown;
}

const resumeTokenSchema = new Schema<IChangeStreamResumeToken>(
  {
    key: { type: String, required: true, unique: true },
    token: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'changestream_resume_tokens' },
);

export const ChangeStreamResumeToken = getOrCreateModel<
  IChangeStreamResumeToken,
  Model<IChangeStreamResumeToken>
>('ChangeStreamResumeToken', resumeTokenSchema);
