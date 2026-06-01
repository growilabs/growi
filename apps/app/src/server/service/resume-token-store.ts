import type { Document, Model } from 'mongoose';
import mongoose, { Schema } from 'mongoose';

import loggerFactory from '~/utils/logger';

import { getOrCreateModel } from '../util/mongoose-utils';

const logger = loggerFactory('growi:service:resume-token-store');

interface ResumeTokenDocument extends Document {
  key: string;
  token: unknown;
}

const resumeTokenSchema = new Schema<ResumeTokenDocument>(
  {
    key: { type: String, required: true, unique: true },
    token: { type: Schema.Types.Mixed, required: true },
  },
  { collection: 'changestream_resume_tokens' },
);

const ResumeTokenModel = getOrCreateModel<
  ResumeTokenDocument,
  Model<ResumeTokenDocument>
>('ChangeStreamResumeToken', resumeTokenSchema);

export const ResumeTokenStore = {
  async load(key: string): Promise<unknown> {
    try {
      const doc = await ResumeTokenModel.findOne({ key });
      return doc?.token ?? null;
    } catch (err) {
      logger.error('ResumeTokenStore.load failed.', err);
      return null;
    }
  },

  async save(key: string, token: unknown): Promise<void> {
    try {
      await ResumeTokenModel.findOneAndUpdate(
        { key },
        { token },
        { upsert: true, new: true },
      );
    } catch (err) {
      logger.error('ResumeTokenStore.save failed.', err);
    }
  },

  async clear(key: string): Promise<void> {
    try {
      await ResumeTokenModel.deleteOne({ key });
    } catch (err) {
      logger.error('ResumeTokenStore.clear failed.', err);
    }
  },
};
