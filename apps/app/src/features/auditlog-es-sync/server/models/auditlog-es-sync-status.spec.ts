import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '~/utils/prisma';

import {
  AUDITLOG_SYNC_STATUS_KEY,
  AuditlogEsSyncStatus,
} from './auditlog-es-sync-status';

const mockPrisma = mockDeep<PrismaClient>();

vi.mock('~/utils/prisma', () => ({
  get prisma() {
    return mockPrisma;
  },
}));

describe('AuditlogEsSyncStatus.setUnsynced()', () => {
  it('upserts the flag with the given value', async () => {
    await AuditlogEsSyncStatus.setUnsynced(true);

    expect(mockPrisma.auditlog_es_sync_status.upsert).toHaveBeenCalledWith({
      where: { key: AUDITLOG_SYNC_STATUS_KEY },
      update: { hasUnsyncedEvents: true },
      create: { key: AUDITLOG_SYNC_STATUS_KEY, hasUnsyncedEvents: true },
    });
  });

  it('rethrows when the write fails, so callers can observe and log it', async () => {
    mockPrisma.auditlog_es_sync_status.upsert.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(AuditlogEsSyncStatus.setUnsynced(false)).rejects.toThrow(
      'db unavailable',
    );
  });
});

describe('AuditlogEsSyncStatus.isUnsynced()', () => {
  it('returns the persisted flag value', async () => {
    mockPrisma.auditlog_es_sync_status.findUnique.mockResolvedValue({
      id: 'record-id',
      key: AUDITLOG_SYNC_STATUS_KEY,
      hasUnsyncedEvents: true,
    });

    await expect(AuditlogEsSyncStatus.isUnsynced()).resolves.toBe(true);
  });

  it('falls back to false when no record exists', async () => {
    mockPrisma.auditlog_es_sync_status.findUnique.mockResolvedValue(null);

    await expect(AuditlogEsSyncStatus.isUnsynced()).resolves.toBe(false);
  });

  it('falls back to false when the read fails', async () => {
    mockPrisma.auditlog_es_sync_status.findUnique.mockRejectedValue(
      new Error('db unavailable'),
    );

    await expect(AuditlogEsSyncStatus.isUnsynced()).resolves.toBe(false);
  });
});
