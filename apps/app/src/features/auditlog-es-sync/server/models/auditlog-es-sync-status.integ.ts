import { prisma } from '~/utils/prisma';

import { AuditlogEsSyncStatus } from './auditlog-es-sync-status';

vi.mock('~/utils/logger', () => ({
  default: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('AuditlogEsSyncStatus', () => {
  afterEach(async () => {
    await prisma.auditlog_es_sync_status.deleteMany({});
    vi.restoreAllMocks();
  });

  describe('isUnsynced', () => {
    it('returns false when no document exists (default)', async () => {
      expect(await AuditlogEsSyncStatus.isUnsynced()).toBe(false);
    });
  });

  describe('setUnsynced + isUnsynced', () => {
    it('setUnsynced(true) makes isUnsynced() return true', async () => {
      await AuditlogEsSyncStatus.setUnsynced(true);
      expect(await AuditlogEsSyncStatus.isUnsynced()).toBe(true);
    });

    it('setUnsynced(false) makes isUnsynced() return false', async () => {
      await AuditlogEsSyncStatus.setUnsynced(false);
      expect(await AuditlogEsSyncStatus.isUnsynced()).toBe(false);
    });

    it('second setUnsynced with the same key reflects the latest value (upsert semantics)', async () => {
      await AuditlogEsSyncStatus.setUnsynced(true);
      await AuditlogEsSyncStatus.setUnsynced(false);

      expect(await AuditlogEsSyncStatus.isUnsynced()).toBe(false);
      const count = await prisma.auditlog_es_sync_status.count({
        where: { key: 'auditlogs' },
      });
      expect(count).toBe(1);
    });
  });

  describe('error handling', () => {
    it('setUnsynced rethrows when prisma throws, unlike isUnsynced', async () => {
      vi.spyOn(prisma.auditlog_es_sync_status, 'upsert').mockRejectedValueOnce(
        new Error('DB error'),
      );
      await expect(AuditlogEsSyncStatus.setUnsynced(true)).rejects.toThrow(
        'DB error',
      );
    });

    it('isUnsynced returns false when prisma throws', async () => {
      vi.spyOn(
        prisma.auditlog_es_sync_status,
        'findUnique',
      ).mockRejectedValueOnce(new Error('DB error'));
      expect(await AuditlogEsSyncStatus.isUnsynced()).toBe(false);
    });
  });
});
