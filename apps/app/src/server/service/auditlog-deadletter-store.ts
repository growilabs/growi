import type { Document, Model } from 'mongoose';
import { Schema } from 'mongoose';

import loggerFactory from '~/utils/logger';

import { getOrCreateModel } from '../util/mongoose-utils';

const logger = loggerFactory('growi:service:auditlog-deadletter-store');

const TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

interface AuditlogDeadletterDocument extends Document {
  token: unknown;
  skippedAt: Date;
}

const auditlogDeadletterSchema = new Schema<AuditlogDeadletterDocument>(
  {
    token: { type: Schema.Types.Mixed, required: true },
    skippedAt: { type: Date, default: () => new Date(), expires: TTL_SECONDS },
  },
  { collection: 'auditlog_deadletter' },
);

const AuditlogDeadletterModel = getOrCreateModel<
  AuditlogDeadletterDocument,
  Model<AuditlogDeadletterDocument>
>('AuditlogDeadletter', auditlogDeadletterSchema);

export const AuditlogDeadletterStore = {
  async save(token: unknown): Promise<void> {
    try {
      await AuditlogDeadletterModel.create({ token });
    } catch (err) {
      logger.error('AuditlogDeadletterStore.save failed.', err);
    }
  },

  async clear(): Promise<void> {
    try {
      await AuditlogDeadletterModel.deleteMany({});
    } catch (err) {
      logger.error('AuditlogDeadletterStore.clear failed.', err);
    }
  },
};
