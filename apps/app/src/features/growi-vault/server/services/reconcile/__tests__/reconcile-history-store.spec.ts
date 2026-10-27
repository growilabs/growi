/**
 * reconcile-history-store.spec.ts
 *
 * Unit tests for HistoryStore — vault_reconcile_log CRUD wrapper.
 *
 * Requirements: 5.1, 5.5
 * Design: Components and Interfaces > HistoryStore
 *
 * All tests use a mocked VaultReconcileLog Mongoose model.
 * No real MongoDB connection is required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  HistoryStore,
  ReconcileLogEntry,
} from '../reconcile-history-store';
import { createHistoryStore } from '../reconcile-history-store';

// ---------------------------------------------------------------------------
// Mock model factory
// ---------------------------------------------------------------------------

/**
 * Builds a minimal mock that satisfies the subset of VaultReconcileLogModel
 * used by HistoryStore.
 *
 * Each method is a vi.fn() so tests can spy on call arguments and control
 * return values via mockResolvedValueOnce / mockReturnValueOnce.
 */
function buildMockModel() {
  // find().sort().skip().limit().lean() chain helpers
  const leanFn = vi.fn();
  const limitFn = vi.fn().mockReturnValue({ lean: leanFn });
  const skipFn = vi.fn().mockReturnValue({ limit: limitFn });
  const sortFn = vi.fn().mockReturnValue({ skip: skipFn });
  const findFn = vi.fn().mockReturnValue({ sort: sortFn });

  return {
    create: vi.fn(),
    updateOne: vi.fn(),
    updateMany: vi.fn(),
    // find chain
    find: findFn,
    // Expose chain members so tests can configure return values
    _chain: { sortFn, skipFn, limitFn, leanFn },
  };
}

type MockModel = ReturnType<typeof buildMockModel>;

// ---------------------------------------------------------------------------
// Shared sample data
// ---------------------------------------------------------------------------

const SAMPLE_ENTRY: Omit<
  ReconcileLogEntry,
  'startedAt' | 'completedAt' | 'lastError'
> = {
  reconcileId: 'test-reconcile-id-001',
  triggeredBy: { userId: 'user-abc', isAdmin: false },
  targetType: 'page',
  targetPath: '/test/page',
  descendantCount: 5,
  processedCount: 0,
  status: 'pending',
  triggeredAt: new Date('2026-01-01T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoryStore', () => {
  let mockModel: MockModel;
  let store: HistoryStore;

  beforeEach(() => {
    mockModel = buildMockModel();
    // biome-ignore lint/suspicious/noExplicitAny: mock type cast
    store = createHistoryStore({ vaultReconcileLog: mockModel as any });
  });

  // -------------------------------------------------------------------------
  // 1. create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('calls model.create with the entry fields', async () => {
      mockModel.create.mockResolvedValueOnce({});

      await store.create(SAMPLE_ENTRY);

      expect(mockModel.create).toHaveBeenCalledOnce();
      const arg = mockModel.create.mock.calls[0][0];
      expect(arg.reconcileId).toBe(SAMPLE_ENTRY.reconcileId);
      expect(arg.triggeredBy).toEqual(SAMPLE_ENTRY.triggeredBy);
      expect(arg.targetType).toBe(SAMPLE_ENTRY.targetType);
      expect(arg.targetPath).toBe(SAMPLE_ENTRY.targetPath);
      expect(arg.descendantCount).toBe(SAMPLE_ENTRY.descendantCount);
      expect(arg.processedCount).toBe(SAMPLE_ENTRY.processedCount);
      expect(arg.status).toBe(SAMPLE_ENTRY.status);
      expect(arg.triggeredAt).toBe(SAMPLE_ENTRY.triggeredAt);
    });

    it('returns void (resolves without a value)', async () => {
      mockModel.create.mockResolvedValueOnce({});
      const result = await store.create(SAMPLE_ENTRY);
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. updateStatus
  // -------------------------------------------------------------------------

  describe('updateStatus', () => {
    it('calls model.updateOne with reconcileId filter and $set patch', async () => {
      mockModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      const patch = {
        status: 'running' as const,
        startedAt: new Date('2026-01-01T01:00:00Z'),
      };
      await store.updateStatus('test-reconcile-id-001', patch);

      expect(mockModel.updateOne).toHaveBeenCalledOnce();
      const [filter, update] = mockModel.updateOne.mock.calls[0];
      expect(filter).toEqual({ reconcileId: 'test-reconcile-id-001' });
      expect(update.$set).toMatchObject(patch);
    });

    it('includes all patch fields in the $set update', async () => {
      mockModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });

      const patch = {
        status: 'completed' as const,
        completedAt: new Date('2026-01-01T02:00:00Z'),
        processedCount: 42,
        lastError: undefined,
      };
      await store.updateStatus('test-reconcile-id-001', patch);

      const [, update] = mockModel.updateOne.mock.calls[0];
      expect(update.$set.status).toBe('completed');
      expect(update.$set.completedAt).toEqual(patch.completedAt);
      expect(update.$set.processedCount).toBe(42);
    });

    it('returns void', async () => {
      mockModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
      const result = await store.updateStatus('test-id', { status: 'running' });
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. listRecent
  // -------------------------------------------------------------------------

  describe('listRecent', () => {
    it('calls model.find with triggeredAt descending sort', async () => {
      const docs = [
        {
          ...SAMPLE_ENTRY,
          _id: 'doc1',
          triggeredAt: new Date('2026-01-02T00:00:00Z'),
        },
        {
          ...SAMPLE_ENTRY,
          _id: 'doc2',
          triggeredAt: new Date('2026-01-01T00:00:00Z'),
        },
      ];
      mockModel._chain.leanFn.mockResolvedValueOnce(docs);

      await store.listRecent({ limit: 10 });

      expect(mockModel.find).toHaveBeenCalledOnce();
      expect(mockModel._chain.sortFn).toHaveBeenCalledWith({ triggeredAt: -1 });
    });

    it('applies the requested limit', async () => {
      mockModel._chain.leanFn.mockResolvedValueOnce([]);

      await store.listRecent({ limit: 5 });

      expect(mockModel._chain.limitFn).toHaveBeenCalledWith(5);
    });

    it('defaults offset to 0 when not provided', async () => {
      mockModel._chain.leanFn.mockResolvedValueOnce([]);

      await store.listRecent({ limit: 10 });

      expect(mockModel._chain.skipFn).toHaveBeenCalledWith(0);
    });

    it('applies explicit offset', async () => {
      mockModel._chain.leanFn.mockResolvedValueOnce([]);

      await store.listRecent({ limit: 10, offset: 20 });

      expect(mockModel._chain.skipFn).toHaveBeenCalledWith(20);
    });

    it('returns the documents as a readonly array', async () => {
      const docs = [
        { ...SAMPLE_ENTRY, triggeredAt: new Date('2026-01-01T00:00:00Z') },
      ];
      mockModel._chain.leanFn.mockResolvedValueOnce(docs);

      const result = await store.listRecent({ limit: 10 });

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].reconcileId).toBe(SAMPLE_ENTRY.reconcileId);
    });
  });

  // -------------------------------------------------------------------------
  // 4. normalizeStaleLifecycle
  // -------------------------------------------------------------------------

  describe('normalizeStaleLifecycle', () => {
    it('calls model.updateMany with status $in [running, pending]', async () => {
      mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 3 });

      await store.normalizeStaleLifecycle();

      expect(mockModel.updateMany).toHaveBeenCalledOnce();
      const [filter] = mockModel.updateMany.mock.calls[0];
      expect(filter.status).toEqual({ $in: ['running', 'pending'] });
    });

    it('sets status to failed, lastError to process-restarted, and completedAt in the update', async () => {
      mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 2 });

      const before = new Date();
      await store.normalizeStaleLifecycle();
      const after = new Date();

      const [, update] = mockModel.updateMany.mock.calls[0];
      expect(update.$set.status).toBe('failed');
      expect(update.$set.lastError).toBe('process-restarted');
      expect(update.$set.completedAt).toBeInstanceOf(Date);
      // completedAt should be between before and after
      expect(update.$set.completedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(update.$set.completedAt.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );
    });

    it('returns the count of updated records', async () => {
      mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 3 });

      const count = await store.normalizeStaleLifecycle();

      expect(count).toBe(3);
    });

    it('returns 0 when no stale records exist', async () => {
      mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 0 });

      const count = await store.normalizeStaleLifecycle();

      expect(count).toBe(0);
    });

    it('normalizes both running and pending records in a single updateMany call', async () => {
      // Simulates a scenario where 1 running + 2 pending records exist
      mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 3 });

      const count = await store.normalizeStaleLifecycle();

      // Both statuses covered by the $in filter — only one updateMany call needed
      expect(mockModel.updateMany).toHaveBeenCalledTimes(1);
      const [filter] = mockModel.updateMany.mock.calls[0];
      // Verify the filter covers both statuses
      const statuses: string[] = filter.status.$in;
      expect(statuses).toContain('running');
      expect(statuses).toContain('pending');
      expect(count).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Lifecycle transition scenario
  // -------------------------------------------------------------------------

  describe('full lifecycle: create → updateStatus → listRecent → normalizeStaleLifecycle', () => {
    it('transitions through the full lifecycle correctly', async () => {
      // Step 1: create
      mockModel.create.mockResolvedValueOnce({});
      await store.create(SAMPLE_ENTRY);
      expect(mockModel.create).toHaveBeenCalledOnce();

      // Step 2: update to running
      mockModel.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
      await store.updateStatus(SAMPLE_ENTRY.reconcileId, {
        status: 'running',
        startedAt: new Date(),
      });
      expect(mockModel.updateOne).toHaveBeenCalledOnce();

      // Step 3: listRecent returns the running record
      const runningDoc = { ...SAMPLE_ENTRY, status: 'running' };
      mockModel._chain.leanFn.mockResolvedValueOnce([runningDoc]);
      const entries = await store.listRecent({ limit: 10 });
      expect(entries).toHaveLength(1);
      expect(entries[0].status).toBe('running');

      // Step 4: normalizeStaleLifecycle converts running → failed
      mockModel.updateMany.mockResolvedValueOnce({ modifiedCount: 1 });
      const normalized = await store.normalizeStaleLifecycle();
      expect(normalized).toBe(1);
      const [, update] = mockModel.updateMany.mock.calls[0];
      expect(update.$set.status).toBe('failed');
      expect(update.$set.lastError).toBe('process-restarted');
    });
  });
});
