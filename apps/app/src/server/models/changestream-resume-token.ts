import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '../util/mongoose-utils';

export interface IChangeStreamResumeToken {
  key: string;
  token: unknown;
}

export interface IChangeStreamResumeTokenDocument
  extends IChangeStreamResumeToken,
    Document {}

const resumeTokenSchema = new Schema<IChangeStreamResumeTokenDocument>(
  {
    key: { type: String, required: true, unique: true },
    token: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'changestream_resume_tokens' },
);

export const ChangeStreamResumeToken = getOrCreateModel<
  IChangeStreamResumeTokenDocument,
  Model<IChangeStreamResumeTokenDocument>
>('ChangeStreamResumeToken', resumeTokenSchema);
