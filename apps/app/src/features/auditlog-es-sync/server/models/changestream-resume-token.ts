import type { Model } from 'mongoose';
import { Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:models:changestream-resume-token');

export interface IChangeStreamResumeToken {
  key: string;
  // ResumeToken is an opaque value in the MongoDB driver (typed as `unknown`);
  // its internal structure is not a public API, so it is stored as-is via Mixed.
  token: unknown;
}

interface IChangeStreamResumeTokenModel
  extends Model<IChangeStreamResumeToken> {
  load(key: string): Promise<unknown>;
  upsert(key: string, token: unknown): Promise<void>;
  clear(key: string): Promise<void>;
}

const resumeTokenSchema = new Schema<
  IChangeStreamResumeToken,
  IChangeStreamResumeTokenModel
>(
  {
    key: { type: String, required: true, unique: true },
    token: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'changestream_resume_tokens' },
);

resumeTokenSchema.statics.load = async function (
  key: string,
): Promise<unknown> {
  try {
    const doc = await this.findOne({ key });
    return doc?.token ?? null;
  } catch (err) {
    logger.error('ChangeStreamResumeToken.load failed.', err);
    return null;
  }
};

resumeTokenSchema.statics.upsert = async function (
  key: string,
  token: unknown,
): Promise<void> {
  try {
    await this.findOneAndUpdate(
      { key },
      { token },
      { upsert: true, new: true },
    );
  } catch (err) {
    logger.error('ChangeStreamResumeToken.upsert failed.', err);
  }
};

resumeTokenSchema.statics.clear = async function (key: string): Promise<void> {
  try {
    await this.deleteOne({ key });
  } catch (err) {
    logger.error('ChangeStreamResumeToken.clear failed.', err);
  }
};

export const ChangeStreamResumeToken = getOrCreateModel<
  IChangeStreamResumeToken,
  IChangeStreamResumeTokenModel
>('ChangeStreamResumeToken', resumeTokenSchema);
