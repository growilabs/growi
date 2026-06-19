import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:features:auditlog-es-sync:models:auditlog-es-sync-status',
);

export const AUDITLOG_SYNC_STATUS_KEY = 'auditlogs';

export const AuditlogEsSyncStatus = {
  async setUnsynced(value: boolean): Promise<void> {
    try {
      await prisma.auditlog_es_sync_status.upsert({
        where: { key: AUDITLOG_SYNC_STATUS_KEY },
        update: { hasUnsyncedEvents: value },
        create: { key: AUDITLOG_SYNC_STATUS_KEY, hasUnsyncedEvents: value },
      });
    } catch (err) {
      logger.error('AuditlogEsSyncStatus.setUnsynced failed.', err);
    }
  },

  async isUnsynced(): Promise<boolean> {
    try {
      const doc = await prisma.auditlog_es_sync_status.findUnique({
        where: { key: AUDITLOG_SYNC_STATUS_KEY },
      });
      return doc?.hasUnsyncedEvents ?? false;
    } catch (err) {
      logger.error('AuditlogEsSyncStatus.isUnsynced failed.', err);
      return false;
    }
  },
};
