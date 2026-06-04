import loggerFactory from '~/utils/logger';

import { AuditlogDeadletter } from '../models/auditlog-deadletter';

const logger = loggerFactory('growi:service:auditlog-deadletter-store');

export const AuditlogDeadletterStore = {
  async save(token: unknown): Promise<void> {
    try {
      await AuditlogDeadletter.create({ token });
    } catch (err) {
      logger.error('AuditlogDeadletterStore.save failed.', err);
    }
  },

  async clear(): Promise<void> {
    try {
      await AuditlogDeadletter.deleteMany({});
    } catch (err) {
      logger.error('AuditlogDeadletterStore.clear failed.', err);
    }
  },
};
