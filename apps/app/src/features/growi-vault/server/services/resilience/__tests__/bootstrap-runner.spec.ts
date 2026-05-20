/**
 * bootstrap-runner.spec.ts
 *
 * Unit tests for BootstrapRunner (Task 4.2).
 * All external I/O is mocked via dependency injection — no real MongoDB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VaultResilienceLayer } from '../bootstrap-runner';
import { createBootstrapRunner } from '../bootstrap-runner';

// ---------------------------------------------------------------------------
// Helpers — mock factory
// ---------------------------------------------------------------------------

function makeObjectId(hex: string) {
  // Returns a minimal object that behaves like a Mongoose ObjectId
  return {
    toString: () => hex,
    toHexString: () => hex,
  };
}

const FAKE_ID_A = makeObjectId('000000000000000000000001');
const FAKE_ID_B = makeObjectId('000000000000000000000002');

// ---------------------------------------------------------------------------
// Mock state builder
// ---------------------------------------------------------------------------

type MockState = {
  bootstrapState:
    | 'pending'
    | 'running'
    | 'verifying'
    | 'done'
    | 'failed'
    | 'retrying'
    | 'escalated';
  bootstrapCursor: object | null;
  bootstrapStartedAt: Date | null;
  bootstrapCompletedAt: Date | null;
  bootstrapTotalEstimated: number | null;
  bootstrapProcessed: number;
  bootstrapLastError: string | null;
  bootstrapInstanceId: string | null;
  bootstrapHeartbeatAt: Date | null;
  bootstrapLastTriggerSource: 'env-true' | 'env-force' | 'admin-ui' | null;
  bootstrapRetryAttempts: number;
  bootstrapRetryNextAt: Date | null;
  bootstrapRetryAborted: boolean;
  bootstrapStreamSnapshotMaxId: object | null;
  driftLastWatermark: Date | null;
  driftLastSweepAt: Date | null;
  driftDetectedSinceBoot: number;
  driftRepairsEmittedSinceBoot: number;
  driftLastError: string | null;
};

function makeDefaultState(): MockState {
  return {
    bootstrapState: 'pending',
    bootstrapCursor: null,
    bootstrapStartedAt: null,
    bootstrapCompletedAt: null,
    bootstrapTotalEstimated: null,
    bootstrapProcessed: 0,
    bootstrapLastError: null,
    bootstrapInstanceId: null,
    bootstrapHeartbeatAt: new Date(),
    bootstrapLastTriggerSource: null,
    bootstrapRetryAttempts: 0,
    bootstrapRetryNextAt: null,
    bootstrapRetryAborted: false,
    bootstrapStreamSnapshotMaxId: null,
    driftLastWatermark: null,
    driftLastSweepAt: null,
    driftDetectedSinceBoot: 0,
    driftRepairsEmittedSinceBoot: 0,
    driftLastError: null,
  };
}

// ---------------------------------------------------------------------------
// Mock page stream
// ---------------------------------------------------------------------------

function makePageDoc(id: { toString(): string }, path: string) {
  return {
    _id: id,
    path,
    status: 'published',
    revision: id, // non-null revision
  };
}

function makeCursor(pages: object[]) {
  let idx = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (idx < pages.length) {
            return { value: pages[idx++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// createRunner helper
// ---------------------------------------------------------------------------

interface RunnerSetup {
  state: MockState;
  mockVaultSyncState: {
    findOneAndUpdate: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
  };
  mockVaultInstruction: {
    create: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
  };
  mockPage: {
    estimatedDocumentCount: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
  };
  mockNamespaceMapper: { computePageNamespaces: ReturnType<typeof vi.fn> };
  mockCreateActivity: ReturnType<typeof vi.fn>;
  runner: VaultResilienceLayer;
}

function createTestRunner(
  initialState: Partial<MockState> = {},
  pages: object[] = [],
): RunnerSetup {
  const state: MockState = { ...makeDefaultState(), ...initialState };

  const mockFindOneAndUpdate = vi.fn().mockImplementation((_q, update) => {
    // Simulate upsert returning current doc merged with $setOnInsert / $set
    if (update.$setOnInsert && state.bootstrapState === 'pending') {
      // Not modifying existing state on setOnInsert when doc exists
    }
    if (update.$set) {
      Object.assign(state, update.$set);
    }
    return Promise.resolve({ ...state });
  });

  const mockFindOne = vi.fn().mockImplementation(() => {
    const lean = () => Promise.resolve({ ...state, _id: 'singleton' });
    return { lean };
  });

  const mockUpdateOne = vi.fn().mockImplementation((_q, update) => {
    if (update.$set) {
      Object.assign(state, update.$set);
    }
    return Promise.resolve({ modifiedCount: 1 });
  });

  const mockVaultSyncState = {
    findOneAndUpdate: mockFindOneAndUpdate,
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  };

  // Track last created instruction _id (simulating mongo ObjectId)
  let instrCounter = 100;
  const lastInstructionHolder = { id: null as object | null };

  const mockVaultInstructionCreate = vi.fn().mockImplementation((data) => {
    const id = makeObjectId(String(instrCounter++).padStart(24, '0'));
    lastInstructionHolder.id = id;
    return Promise.resolve({ _id: id, ...data });
  });

  const mockVaultInstructionFindOne = vi.fn().mockImplementation(() => {
    // By default return the last instruction (simulating it was committed)
    return Promise.resolve(
      lastInstructionHolder.id ? { _id: lastInstructionHolder.id } : null,
    );
  });

  const mockVaultInstruction = {
    create: mockVaultInstructionCreate,
    findOne: mockVaultInstructionFindOne,
  };

  const mockEstimatedDocumentCount = vi.fn().mockResolvedValue(pages.length);

  // findOne for snapshot max _id
  const mockPageFindOne = vi.fn().mockImplementation(() => {
    const page = pages[pages.length - 1] ?? null;
    return Promise.resolve(page);
  });

  const mockFind = vi.fn().mockReturnValue({ cursor: () => makeCursor(pages) });

  const mockPage = {
    estimatedDocumentCount: mockEstimatedDocumentCount,
    find: mockFind,
    findOne: mockPageFindOne,
  };

  const mockComputePageNamespaces = vi.fn().mockReturnValue({
    current: ['public'],
  });

  const mockNamespaceMapper = {
    computePageNamespaces: mockComputePageNamespaces,
  };

  const mockCreateActivity = vi.fn().mockResolvedValue(undefined);

  const runner = createBootstrapRunner({
    vaultSyncState: mockVaultSyncState as any,
    vaultInstruction: mockVaultInstruction as any,
    pageModel: mockPage as any,
    namespaceMapper: mockNamespaceMapper,
    retryConfig: { maxAttempts: 3, baseBackoffMs: 100, maxBackoffMs: 1000 },
    heartbeatIntervalMs: 60_000,
    heartbeatStaleMs: 120_000,
    createActivity: mockCreateActivity,
  });

  return {
    state,
    mockVaultSyncState,
    mockVaultInstruction,
    mockPage,
    mockNamespaceMapper,
    mockCreateActivity,
    runner,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BootstrapRunner', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // (a) env=true + pending → done (full flow)
  // -------------------------------------------------------------------------

  describe('(a) env=true + pending → done', () => {
    it('transitions to done and clears cursor after full stream', async () => {
      const pages = [
        makePageDoc(FAKE_ID_A, '/page-a'),
        makePageDoc(FAKE_ID_B, '/page-b'),
      ];

      const { state, runner } = createTestRunner(
        { bootstrapState: 'pending' },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapState).toBe('done');
      expect(state.bootstrapCursor).toBeNull();
      expect(state.bootstrapCompletedAt).toBeInstanceOf(Date);
      expect(state.bootstrapLastTriggerSource).toBe('env-true');
    });

    it('emits bulk-upsert instructions for streamed pages', async () => {
      const pages = [
        makePageDoc(FAKE_ID_A, '/page-a'),
        makePageDoc(FAKE_ID_B, '/page-b'),
      ];

      const { mockVaultInstruction, runner } = createTestRunner(
        { bootstrapState: 'pending' },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-true' });

      const createCalls = mockVaultInstruction.create.mock.calls.map(
        (c: any) => c[0].op,
      );
      expect(createCalls).toContain('bulk-upsert');
    });

    it('does NOT emit reset-all for normal start', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { mockVaultInstruction, runner } = createTestRunner(
        { bootstrapState: 'pending' },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-true' });

      const createCalls = mockVaultInstruction.create.mock.calls.map(
        (c: any) => c[0].op,
      );
      expect(createCalls).not.toContain('reset-all');
    });

    it('getStatus returns consistent ResilienceStatus after completion', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { runner } = createTestRunner({ bootstrapState: 'pending' }, pages);

      await runner.bootstrap({ triggerSource: 'env-true' });

      const status = await runner.getStatus();
      expect(status.bootstrap.state).toBe('done');
      expect(status.bootstrap.cursor).toBeNull();
      expect(status.lastTriggerSource).toBe('env-true');
    });
  });

  // -------------------------------------------------------------------------
  // (b) env=true + done → no-op (skip action)
  // -------------------------------------------------------------------------

  describe('(b) env=true + done → no-op', () => {
    it('does not modify state when bootstrap is already done', async () => {
      const { state, mockVaultInstruction, runner } = createTestRunner({
        bootstrapState: 'done',
      });

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapState).toBe('done');
      expect(mockVaultInstruction.create).not.toHaveBeenCalled();
    });

    it('getStatus reflects done state unchanged', async () => {
      const completedAt = new Date('2025-01-01');
      const { runner } = createTestRunner({
        bootstrapState: 'done',
        bootstrapCompletedAt: completedAt,
      });

      await runner.bootstrap({ triggerSource: 'env-true' });

      const status = await runner.getStatus();
      expect(status.bootstrap.state).toBe('done');
      expect(status.bootstrap.completedAt).toEqual(completedAt);
    });
  });

  // -------------------------------------------------------------------------
  // (c) env=force + done → reset-all + new bootstrap + forceWarningActive
  // -------------------------------------------------------------------------

  describe('(c) env=force + done → reset-all + new bootstrap', () => {
    it('emits reset-all instruction on force wipe', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { mockVaultInstruction, runner } = createTestRunner(
        { bootstrapState: 'done' },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-force' });

      const ops = mockVaultInstruction.create.mock.calls.map(
        (c: any) => c[0].op,
      );
      expect(ops).toContain('reset-all');
    });

    it('transitions to done after force wipe bootstrap', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { state, runner } = createTestRunner(
        { bootstrapState: 'done' },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-force' });

      expect(state.bootstrapState).toBe('done');
      expect(state.bootstrapLastTriggerSource).toBe('env-force');
    });

    it('sets forceWarningActive in status when triggerSource is env-force', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { runner } = createTestRunner({ bootstrapState: 'done' }, pages);

      await runner.bootstrap({ triggerSource: 'env-force' });

      const status = await runner.getStatus();
      expect(status.forceWarningActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // (d) env=true + failed → resume (no reset-all)
  // -------------------------------------------------------------------------

  describe('(d) env=true + failed → resume from cursor', () => {
    it('resumes from existing cursor without reset-all', async () => {
      const pages = [makePageDoc(FAKE_ID_B, '/page-b')];
      const { mockVaultInstruction, state, runner } = createTestRunner(
        {
          bootstrapState: 'failed',
          bootstrapCursor: FAKE_ID_A,
          bootstrapRetryAttempts: 1,
        },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-true' });

      const ops = mockVaultInstruction.create.mock.calls.map(
        (c: any) => c[0].op,
      );
      expect(ops).not.toContain('reset-all');
      expect(state.bootstrapState).toBe('done');
    });

    it('clears cursor after successful resume', async () => {
      const pages = [makePageDoc(FAKE_ID_B, '/page-b')];
      const { state, runner } = createTestRunner(
        {
          bootstrapState: 'failed',
          bootstrapCursor: FAKE_ID_A,
          bootstrapRetryAttempts: 0,
        },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapCursor).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // (e) stale running → resume
  // -------------------------------------------------------------------------

  describe('(e) stale running → resume', () => {
    it('resumes when running state has stale heartbeat', async () => {
      const staleHeartbeat = new Date(Date.now() - 300_000); // 5 min ago
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { state, runner } = createTestRunner(
        {
          bootstrapState: 'running',
          bootstrapHeartbeatAt: staleHeartbeat,
          bootstrapCursor: null,
        },
        pages,
      );

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapState).toBe('done');
    });

    it('skips when running state has fresh heartbeat', async () => {
      const freshHeartbeat = new Date(); // just now
      const { state, mockVaultInstruction, runner } = createTestRunner({
        bootstrapState: 'running',
        bootstrapHeartbeatAt: freshHeartbeat,
        bootstrapCursor: null,
      });

      await runner.bootstrap({ triggerSource: 'env-true' });

      // Should skip — no instructions emitted, state unchanged
      expect(mockVaultInstruction.create).not.toHaveBeenCalled();
      expect(state.bootstrapState).toBe('running');
    });
  });

  // -------------------------------------------------------------------------
  // (f) completeness check fail → failed + bootstrapLastError set
  // -------------------------------------------------------------------------

  describe('(f) completeness check failure → failed state', () => {
    it('sets failed state with error when last instruction not committed', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];

      const { state, mockVaultInstruction, runner } = createTestRunner(
        { bootstrapState: 'pending' },
        pages,
      );

      // Override findOne to simulate instruction not committed
      mockVaultInstruction.findOne.mockResolvedValue(null);

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapState).toBe('failed');
      expect(state.bootstrapLastError).toBeTruthy();
      expect(typeof state.bootstrapLastError).toBe('string');
    });

    it('sets failed state when cursor did not reach streamSnapshotMaxId', async () => {
      // Stream only contains FAKE_ID_A, but findOne (snapshotMaxId) returns FAKE_ID_B
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { state, mockPage, runner } = createTestRunner(
        { bootstrapState: 'pending' },
        pages,
      );

      // Simulate a page FAKE_ID_B existing at snapshot time but not in the stream
      mockPage.findOne.mockResolvedValue(makePageDoc(FAKE_ID_B, '/page-b'));

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapState).toBe('failed');
      expect(state.bootstrapLastError).toContain('streamSnapshotMaxId');
    });
  });

  // -------------------------------------------------------------------------
  // (g) max retry → escalated, then abortAutoRetry restores to failed
  // -------------------------------------------------------------------------

  describe('(g) max retry → escalated, abortAutoRetry restores to failed', () => {
    it('transitions to escalated when retry budget exhausted', async () => {
      // retryConfig.maxAttempts = 3; retryAttempts = 3 → budget exhausted
      const { state, runner } = createTestRunner({
        bootstrapState: 'failed',
        bootstrapRetryAttempts: 3,
        bootstrapRetryAborted: false,
      });

      await runner.bootstrap({ triggerSource: 'env-true' });

      expect(state.bootstrapState).toBe('escalated');
    });

    it('abortAutoRetry sets aborted flag and retry fields', async () => {
      const { state, runner } = createTestRunner({
        bootstrapState: 'escalated',
        bootstrapRetryAttempts: 3,
        bootstrapRetryNextAt: new Date(Date.now() + 60_000),
        bootstrapRetryAborted: false,
      });

      await runner.abortAutoRetry();

      expect(state.bootstrapRetryAborted).toBe(true);
      expect(state.bootstrapRetryNextAt).toBeNull();
    });

    it('abortAutoRetry downgrades escalated to failed', async () => {
      const { state, runner } = createTestRunner({
        bootstrapState: 'escalated',
        bootstrapRetryAttempts: 3,
        bootstrapRetryAborted: false,
      });

      await runner.abortAutoRetry();

      expect(state.bootstrapState).toBe('failed');
    });

    it('abortAutoRetry resets retry attempt count to 0', async () => {
      const { state, runner } = createTestRunner({
        bootstrapState: 'escalated',
        bootstrapRetryAttempts: 5,
        bootstrapRetryAborted: false,
      });

      await runner.abortAutoRetry();

      expect(state.bootstrapRetryAttempts).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // (h) abort: aborted flag persists while in-flight bootstrap completes
  // -------------------------------------------------------------------------

  describe('(h) abort flag is respected after bootstrap completes naturally', () => {
    it('aborted=true prevents future retry trigger', async () => {
      const { state, runner } = createTestRunner({
        bootstrapState: 'failed',
        bootstrapRetryAttempts: 2,
        bootstrapRetryAborted: true,
      });

      // Even though state is 'failed' with retries allowed, aborted=true means skip
      await runner.bootstrap({ triggerSource: 'env-true' });

      // Should not have bootstrapped (skip action)
      expect(state.bootstrapState).toBe('failed');
    });
  });

  // -------------------------------------------------------------------------
  // getStatus — comprehensive check
  // -------------------------------------------------------------------------

  describe('getStatus()', () => {
    it('returns null fields when no doc exists', async () => {
      const { mockVaultSyncState, runner } = createTestRunner();

      mockVaultSyncState.findOne.mockReturnValue({
        lean: () => Promise.resolve(null),
      });

      const status = await runner.getStatus();

      expect(status.bootstrap.state).toBe('pending');
      expect(status.bootstrap.cursor).toBeNull();
      expect(status.retry).toBeNull();
      expect(status.drift).toBeNull();
      expect(status.lastTriggerSource).toBeNull();
      expect(status.forceWarningActive).toBe(false);
    });

    it('populates RetryStatus when retry fields are set', async () => {
      const nextAt = new Date(Date.now() + 30_000);
      const { runner } = createTestRunner({
        bootstrapState: 'retrying',
        bootstrapRetryAttempts: 2,
        bootstrapRetryNextAt: nextAt,
        bootstrapRetryAborted: false,
        bootstrapLastError: 'timeout',
      });

      const status = await runner.getStatus();

      expect(status.retry).not.toBeNull();
      expect(status.retry!.attemptNo).toBe(2);
      expect(status.retry!.nextAttemptAt).toEqual(nextAt);
      expect(status.retry!.lastError).toBe('timeout');
      expect(status.retry!.aborted).toBe(false);
    });

    it('populates DriftStatus when drift fields are set', async () => {
      const sweepAt = new Date('2025-06-01');
      const { runner } = createTestRunner({
        driftLastSweepAt: sweepAt,
        driftDetectedSinceBoot: 3,
        driftRepairsEmittedSinceBoot: 2,
        driftLastError: null,
      });

      const status = await runner.getStatus();

      expect(status.drift).not.toBeNull();
      expect(status.drift!.lastSweepAt).toEqual(sweepAt);
      expect(status.drift!.detectedSinceBoot).toBe(3);
      expect(status.drift!.repairsEmittedSinceBoot).toBe(2);
    });

    it('forceWarningActive is true when lastTriggerSource is env-force', async () => {
      const { runner } = createTestRunner({
        bootstrapLastTriggerSource: 'env-force',
        bootstrapState: 'done',
      });

      const status = await runner.getStatus();

      expect(status.forceWarningActive).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  describe('stop()', () => {
    it('resolves without throwing', async () => {
      const { runner } = createTestRunner();
      await expect(runner.stop()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // initOnStartup()
  // -------------------------------------------------------------------------

  describe('initOnStartup()', () => {
    it('triggers bootstrap when state is pending', async () => {
      const pages = [makePageDoc(FAKE_ID_A, '/page-a')];
      const { state, runner } = createTestRunner(
        { bootstrapState: 'pending' },
        pages,
      );

      await runner.initOnStartup();

      expect(state.bootstrapState).toBe('done');
    });

    it('does not bootstrap when state is done', async () => {
      const { state, mockVaultInstruction, runner } = createTestRunner({
        bootstrapState: 'done',
      });

      await runner.initOnStartup();

      expect(mockVaultInstruction.create).not.toHaveBeenCalled();
      expect(state.bootstrapState).toBe('done');
    });
  });
});
