import loggerFactory from '~/utils/logger';

import { ChangeStreamResumeToken } from '../models/changestream-resume-token';

const logger = loggerFactory('growi:service:resume-token-store');

export const ResumeTokenStore = {
  async load(key: string): Promise<unknown> {
    try {
      const doc = await ChangeStreamResumeToken.findOne({ key });
      return doc?.token ?? null;
    } catch (err) {
      logger.error('ResumeTokenStore.load failed.', err);
      return null;
    }
  },

  async save(key: string, token: unknown): Promise<void> {
    try {
      await ChangeStreamResumeToken.findOneAndUpdate(
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
      await ChangeStreamResumeToken.deleteOne({ key });
    } catch (err) {
      logger.error('ResumeTokenStore.clear failed.', err);
    }
  },
};
