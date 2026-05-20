import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDriftDetector } from '../drift-detector';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockVaultSyncStateFindOne = vi.fn();
const mockVaultSyncStateUpdateOne = vi.fn();

const mockVaultSyncState = {
  findOne: mockVaultSyncStateFindOne,
  updateOne: mockVaultSyncStateUpdateOne,
} as unknown as Parameters<typeof createDriftDetector>[0]['vaultSyncState'];

const mockVaultInstructionCreate = vi.fn();

const mockVaultInstruction = {
  create: mockVaultInstructionCreate,
} as unknown as Parameters<typeof createDriftDetector>[0]['vaultInstruction'];

const mockPageFind = vi.fn();
const mockPageModel = {
  find: mockPageFind,
} as unknown as Parameters<typeof createDriftDetector>[0]['pageModel'];

const mockComputePageNamespaces = vi.fn();
const mockNamespaceMapper = {
  computePageNamespaces: mockComputePageNamespaces,
};

const mockCreateActivity = vi.fn();

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

const MAX_PAGES_PER_TICK = 10_000;
const INTERVAL_MS = 300_000;

// ---------------------------------------------------------------------------
// Helper: build a minimal page object
// ---------------------------------------------------------------------------

function makePage(
  overrides: Partial<{ _id: string; path: string; updatedAt: Date }> = {},
) {
  return {
    _id: overrides._id ?? 'page-id-1',
    path: overrides.path ?? '/foo',
    updatedAt: overrides.updatedAt ?? new Date('2024-01-01T00:00:00Z'),
  };
}

// ---------------------------------------------------------------------------
// Helper: build a lean cursor-like array with `.lean()` support
// ---------------------------------------------------------------------------

function makePageCursor(pages: ReturnType<typeof makePage>[]) {
  const cursor = {
    limit: (_n: number) => cursor,
    lean: () => Promise.resolve(pages),
  };
  return cursor;
}

// ---------------------------------------------------------------------------
// Helper: build a VaultSyncState document
// ---------------------------------------------------------------------------

function makeSyncState(overrides: Record<string, unknown> = {}) {
  return {
    bootstrapState: 'done',
    bootstrapCompletedAt: new Date('2024-01-01T00:00:00Z'),
    driftLastWatermark: null,
    driftLastSweepAt: null,
    driftDetectedSinceBoot: 0,
    driftRepairsEmittedSinceBoot: 0,
    driftLastError: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

function createDetector(
  opts: {
    maxPagesPerTick?: number;
    intervalMs?: number;
    createActivity?: (data: unknown) => Promise<unknown>;
  } = {},
) {
  return createDriftDetector({
    vaultSyncState: mockVaultSyncState,
    vaultInstruction: mockVaultInstruction,
    pageModel: mockPageModel,
    namespaceMapper: mockNamespaceMapper,
    maxPagesPerTick: opts.maxPagesPerTick ?? MAX_PAGES_PER_TICK,
    intervalMs: opts.intervalMs ?? INTERVAL_MS,
    createActivity: opts.createActivity ?? mockCreateActivity,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DriftDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockVaultSyncStateUpdateOne.mockResolvedValue({});
    mockVaultInstructionCreate.mockResolvedValue({});
    mockCreateActivity.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // (a) done state + changed pages → bulk-upsert instructions emitted
  // -------------------------------------------------------------------------
  describe('(a) done state + changed pages → bulk-upsert instructions emitted', () => {
    it('emits bulk-upsert instruction per namespace per page', async () => {
      const watermark = new Date('2024-01-01T00:00:00Z');
      const page1 = makePage({
        _id: 'p1',
        path: '/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });
      const page2 = makePage({
        _id: 'p2',
        path: '/bar',
        updatedAt: new Date('2024-01-03T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(makeSyncState({ driftLastWatermark: watermark })),
      });
      mockPageFind.mockReturnValue(makePageCursor([page1, page2]));
      mockComputePageNamespaces.mockImplementation((page) => ({
        current: page.path === '/foo' ? ['public'] : ['public', 'group-abc'],
      }));

      const detector = createDetector();
      await detector['_tick']();

      // page1 → 1 namespace → 1 instruction
      // page2 → 2 namespaces → 2 instructions
      expect(mockVaultInstructionCreate).toHaveBeenCalledTimes(3);

      // All instructions must use op=bulk-upsert
      for (const [doc] of mockVaultInstructionCreate.mock.calls) {
        expect(doc.op).toBe('bulk-upsert');
      }

      // Watermark updated to max(updatedAt) = page2.updatedAt
      const [, update] = mockVaultSyncStateUpdateOne.mock.calls[0];
      expect(update.$set.driftLastWatermark).toEqual(page2.updatedAt);
      expect(update.$set.driftLastError).toBeNull();
    });

    it('updates driftDetectedSinceBoot and driftRepairsEmittedSinceBoot', async () => {
      const page1 = makePage({
        _id: 'p1',
        path: '/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(
            makeSyncState({
              driftDetectedSinceBoot: 5,
              driftRepairsEmittedSinceBoot: 3,
            }),
          ),
      });
      mockPageFind.mockReturnValue(makePageCursor([page1]));
      mockComputePageNamespaces.mockReturnValue({ current: ['public'] });

      const detector = createDetector();
      await detector['_tick']();

      const [, update] = mockVaultSyncStateUpdateOne.mock.calls[0];
      expect(update.$set.driftDetectedSinceBoot).toBe(6); // 5 + 1
      expect(update.$set.driftRepairsEmittedSinceBoot).toBe(4); // 3 + 1
    });
  });

  // -------------------------------------------------------------------------
  // (b) trashed page change → bulk-upsert issued for grant-derived namespace
  // -------------------------------------------------------------------------
  describe('(b) trashed page → bulk-upsert issued (no trash filter)', () => {
    it('does NOT skip /trash/ pages — emits bulk-upsert for their namespace', async () => {
      const trashedPage = makePage({
        _id: 'p-trash',
        path: '/trash/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor([trashedPage]));
      mockComputePageNamespaces.mockReturnValue({ current: ['public'] });

      const detector = createDetector();
      await detector['_tick']();

      // Must emit bulk-upsert even for trash page
      expect(mockVaultInstructionCreate).toHaveBeenCalledTimes(1);
      const [doc] = mockVaultInstructionCreate.mock.calls[0];
      expect(doc.op).toBe('bulk-upsert');
      expect(doc.payload.entries[0].pagePath).toBe('/trash/foo');
    });
  });

  // -------------------------------------------------------------------------
  // (c) restore (/trash/foo → /foo) still emits bulk-upsert
  // -------------------------------------------------------------------------
  describe('(c) restored page (/trash/foo → /foo) → bulk-upsert emitted', () => {
    it('emits bulk-upsert for the restored page path', async () => {
      const restoredPage = makePage({
        _id: 'p-restored',
        path: '/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor([restoredPage]));
      mockComputePageNamespaces.mockReturnValue({ current: ['public'] });

      const detector = createDetector();
      await detector['_tick']();

      expect(mockVaultInstructionCreate).toHaveBeenCalledTimes(1);
      const [doc] = mockVaultInstructionCreate.mock.calls[0];
      expect(doc.op).toBe('bulk-upsert');
      expect(doc.payload.entries[0].pagePath).toBe('/foo');
    });
  });

  // -------------------------------------------------------------------------
  // (d) bootstrapState !== 'done' → tick early return
  // -------------------------------------------------------------------------
  describe('(d) bootstrapState !== done → tick early return', () => {
    it.each([
      'pending',
      'running',
      'verifying',
      'failed',
      'retrying',
      'escalated',
    ] as const)('skips tick when state is %s', async (state) => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState({ bootstrapState: state })),
      });

      const detector = createDetector();
      await detector['_tick']();

      expect(mockVaultInstructionCreate).not.toHaveBeenCalled();
      expect(mockVaultSyncStateUpdateOne).not.toHaveBeenCalled();
    });

    it('also skips when vault_sync_state doc is null', async () => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(null),
      });

      const detector = createDetector();
      await detector['_tick']();

      expect(mockVaultInstructionCreate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // (e) namespace mapper throws → watermark not updated
  // -------------------------------------------------------------------------
  describe('(e) namespaceMapper throws → watermark not updated', () => {
    it('does not update watermark when mapper throws', async () => {
      const page1 = makePage({
        _id: 'p1',
        path: '/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor([page1]));
      mockComputePageNamespaces.mockImplementation(() => {
        throw new Error('mapper failure');
      });

      const detector = createDetector();
      await detector['_tick']();

      // updateOne for watermark must NOT have been called
      const watermarkUpdate = mockVaultSyncStateUpdateOne.mock.calls.find(
        ([, update]) => update.$set?.driftLastWatermark !== undefined,
      );
      expect(watermarkUpdate).toBeUndefined();
    });

    it('records error in driftLastError when mapper throws', async () => {
      const page1 = makePage({
        _id: 'p1',
        path: '/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor([page1]));
      mockComputePageNamespaces.mockImplementation(() => {
        throw new Error('mapper failure');
      });

      const detector = createDetector();
      await detector['_tick']();

      // Some updateOne with driftLastError set must have been called
      const errorUpdate = mockVaultSyncStateUpdateOne.mock.calls.find(
        ([, update]) => update.$set?.driftLastError != null,
      );
      expect(errorUpdate).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // (f) v1 fixed: drift detector does NOT emit `remove`
  // -------------------------------------------------------------------------
  describe('(f) v1 scope: no remove instructions emitted', () => {
    it('never creates an instruction with op=remove', async () => {
      const page1 = makePage({
        _id: 'p1',
        path: '/foo',
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      });

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor([page1]));
      mockComputePageNamespaces.mockReturnValue({ current: ['public'] });

      const detector = createDetector();
      await detector['_tick']();

      for (const [doc] of mockVaultInstructionCreate.mock.calls) {
        expect(doc.op).not.toBe('remove');
      }
    });
  });

  // -------------------------------------------------------------------------
  // (g) scope-out: maxPagesPerTick exceeded
  // -------------------------------------------------------------------------
  describe('(g) scope-out: maxPagesPerTick exceeded', () => {
    it('emits 0 instructions, does not update watermark, sets driftLastError, emits out-of-scope audit event', async () => {
      const maxPages = 5;
      // Return maxPages+1 pages to trigger scope-out
      const pages = Array.from({ length: maxPages + 1 }, (_, i) =>
        makePage({
          _id: `p${i}`,
          path: `/page-${i}`,
          updatedAt: new Date(2024, 0, i + 1),
        }),
      );

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor(pages));

      const detector = createDetector({ maxPagesPerTick: maxPages });
      await detector['_tick']();

      // 0 instructions
      expect(mockVaultInstructionCreate).not.toHaveBeenCalled();

      // Watermark must NOT be updated
      const watermarkUpdate = mockVaultSyncStateUpdateOne.mock.calls.find(
        ([, update]) => update.$set?.driftLastWatermark !== undefined,
      );
      expect(watermarkUpdate).toBeUndefined();

      // driftLastError must be set (2-choice message)
      const errorUpdate = mockVaultSyncStateUpdateOne.mock.calls.find(
        ([, update]) => update.$set?.driftLastError != null,
      );
      expect(errorUpdate).toBeDefined();
      const errorMsg: string = errorUpdate![1].$set.driftLastError;
      // 2-choice message: must mention both resolution options
      expect(errorMsg).toContain('vaultDriftMaxPagesPerTick');
      expect(errorMsg).toContain('VAULT_BOOTSTRAP_ON_START=force');

      // drift-sweep-out-of-scope audit event must be emitted
      const outOfScopeCall = mockCreateActivity.mock.calls.find(
        ([params]) =>
          params?.action === 'vault.resilience.drift-sweep-out-of-scope',
      );
      expect(outOfScopeCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Watermark logic: use bootstrapCompletedAt when driftLastWatermark is null
  // -------------------------------------------------------------------------
  describe('watermark fallback', () => {
    it('uses bootstrapCompletedAt when driftLastWatermark is null', async () => {
      const completedAt = new Date('2024-01-01T12:00:00Z');

      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(
            makeSyncState({
              driftLastWatermark: null,
              bootstrapCompletedAt: completedAt,
            }),
          ),
      });
      mockPageFind.mockReturnValue(makePageCursor([]));

      const detector = createDetector();
      await detector['_tick']();

      // find() should have been called with updatedAt > completedAt
      const [filter] = mockPageFind.mock.calls[0];
      expect(filter.updatedAt.$gt).toEqual(completedAt);
    });

    it('uses epoch 0 when both driftLastWatermark and bootstrapCompletedAt are null', async () => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(
            makeSyncState({
              driftLastWatermark: null,
              bootstrapCompletedAt: null,
            }),
          ),
      });
      mockPageFind.mockReturnValue(makePageCursor([]));

      const detector = createDetector();
      await detector['_tick']();

      const [filter] = mockPageFind.mock.calls[0];
      expect(filter.updatedAt.$gt).toEqual(new Date(0));
    });
  });

  // -------------------------------------------------------------------------
  // start() / stop() interval management
  // -------------------------------------------------------------------------
  describe('start() / stop()', () => {
    it('calls _tick() on each interval', async () => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(makeSyncState({ bootstrapState: 'running' })),
      });

      const detector = createDetector({ intervalMs: 1000 });
      detector.start();

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockVaultSyncStateFindOne).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockVaultSyncStateFindOne).toHaveBeenCalledTimes(2);

      detector.stop();
    });

    it('stop() prevents further ticks', async () => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(makeSyncState({ bootstrapState: 'running' })),
      });

      const detector = createDetector({ intervalMs: 1000 });
      detector.start();
      detector.stop();

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockVaultSyncStateFindOne).not.toHaveBeenCalled();
    });

    it('calling start() twice does not double-tick', async () => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () =>
          Promise.resolve(makeSyncState({ bootstrapState: 'running' })),
      });

      const detector = createDetector({ intervalMs: 1000 });
      detector.start();
      detector.start(); // second call should be a no-op or replace the old interval

      await vi.advanceTimersByTimeAsync(1000);
      // Should be called only once per interval, not twice
      expect(mockVaultSyncStateFindOne).toHaveBeenCalledTimes(1);

      detector.stop();
    });
  });

  // -------------------------------------------------------------------------
  // driftLastSweepAt updated on successful tick
  // -------------------------------------------------------------------------
  describe('driftLastSweepAt', () => {
    it('is set to current date on successful empty tick', async () => {
      mockVaultSyncStateFindOne.mockReturnValue({
        lean: () => Promise.resolve(makeSyncState()),
      });
      mockPageFind.mockReturnValue(makePageCursor([]));

      const now = new Date('2025-05-20T10:00:00Z');
      vi.setSystemTime(now);

      const detector = createDetector();
      await detector['_tick']();

      const [, update] = mockVaultSyncStateUpdateOne.mock.calls[0];
      expect(update.$set.driftLastSweepAt).toEqual(now);
    });
  });
});
