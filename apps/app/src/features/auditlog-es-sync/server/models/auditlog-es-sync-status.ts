import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

const logger = loggerFactory(
  'growi:features:auditlog-es-sync:models:auditlog-es-sync-status',
);

export const AUDITLOG_SYNC_STATUS_KEY = 'auditlogs';

export const AuditlogEsSyncStatus = {
  // Unlike isUnsynced, a write failure has no sensible fallback value, so this
  // rethrows and lets callers decide how to handle/log it (see search.js's rebuild
  // route, which logs with rebuild-specific context on failure).
  async setUnsynced(value: boolean): Promise<void> {
    await prisma.auditlog_es_sync_status.upsert({
      where: { key: AUDITLOG_SYNC_STATUS_KEY },
      update: { hasUnsyncedEvents: value },
      create: { key: AUDITLOG_SYNC_STATUS_KEY, hasUnsyncedEvents: value },
    });
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
