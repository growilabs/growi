import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:features:auditlog-es-sync:models:auditlog-es-sync-status',
);

const KEY = 'auditlogs';

// Failures are swallowed so a status write/read never disrupts the caller's main flow.
export const AuditlogEsSyncStatus = {
  async setUnsynced(value: boolean): Promise<void> {
    try {
      await prisma.auditlog_es_sync_status.upsert({
        where: { key: KEY },
        update: { hasUnsyncedEvents: value },
        create: { key: KEY, hasUnsyncedEvents: value },
      });
    } catch (err) {
      logger.error('AuditlogEsSyncStatus.setUnsynced failed.', err);
    }
  },

  async isUnsynced(): Promise<boolean> {
    try {
      const doc = await prisma.auditlog_es_sync_status.findUnique({
        where: { key: KEY },
      });
      return doc?.hasUnsyncedEvents ?? false;
    } catch (err) {
      logger.error('AuditlogEsSyncStatus.isUnsynced failed.', err);
      return false;
    }
  },
};
