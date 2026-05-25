import type { IPage } from '@growi/core';
import { PageGrant, PageStatus } from '@growi/core';
import type { UpdateQuery } from 'mongoose';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import type { VaultSyncStateDocument } from '~/features/growi-vault/server/models/vault-sync-state';

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports so that vi.mock() hoisting works.
// ---------------------------------------------------------------------------

// Mock VaultInstruction model so tests do not require a real MongoDB connection.
vi.mock('~/features/growi-vault/server/models/vault-instruction', () => ({
  VaultInstruction: {
    create: vi.fn(),
    findOne: vi.fn(),
  },
}));

// Mock VaultSyncState model so tests do not require a real MongoDB connection.
vi.mock('~/features/growi-vault/server/models/vault-sync-state', () => ({
  VaultSyncState: {
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
    findOne: vi.fn(),
  },
}));

// Mock mongoose so tests do not require a real MongoDB connection.
vi.mock('mongoose', async (importOriginal) => {
  const original = await importOriginal<typeof import('mongoose')>();
  return {
    ...original,
    default: {
      ...original.default,
      model: vi.fn(),
    },
  };
});

// Mock logger to suppress output during tests.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock configManager — the resilience layer reads numeric config values at factory time.
vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn((key: string) => {
      const config: Record<string, number | string> = {
        'app:vaultBootstrapRetryMax': 5,
        'app:vaultBootstrapRetryBaseMs': 30_000,
        'app:vaultBootstrapRetryMaxMs': 1_800_000,
        'app:vaultBootstrapHeartbeatIntervalMs': 15_000,
        'app:vaultBootstrapHeartbeatStaleMs': 120_000,
        'app:vaultDriftDetectionIntervalMs': 300_000,
        'app:vaultDriftMaxPagesPerTick': 10_000,
      };
      return config[key] ?? 0;
    }),
  },
}));

// ---------------------------------------------------------------------------
// Lazy imports after mocks are hoisted
// ---------------------------------------------------------------------------

const getVaultInstruction = async () =>
  (await import('~/features/growi-vault/server/models/vault-instruction'))
    .VaultInstruction;

const getVaultSyncState = async () =>
  (await import('~/features/growi-vault/server/models/vault-sync-state'))
    .VaultSyncState;

const getMongoose = async () => (await import('mongoose')).default;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal IPage stub for test cases. */
const buildPage = (
  overrides: Partial<
    IPage & { _id: { toString(): string }; revision?: { toString(): string } }
  > = {},
): IPage & {
  _id: { toString(): string };
  revision?: { toString(): string };
} => {
  return {
    _id: { toString: () => 'page-id-001' },
    path: '/some/page',
    status: PageStatus.STATUS_PUBLISHED,
    grant: PageGrant.GRANT_PUBLIC,
    grantedGroups: [],
    creator: undefined,
    tags: [],
    seenUsers: [],
    grantedUsers: [],
    liker: [],
    parent: null,
    descendantCount: 0,
    isEmpty: false,
    commentCount: 0,
    slackChannels: '',
    deleteUser: undefined as unknown as IPage['deleteUser'],
    deletedAt: undefined as unknown as IPage['deletedAt'],
    createdAt: new Date(),
    updatedAt: new Date(),
    revision: { toString: () => 'rev-001' },
    ...overrides,
  } as unknown as IPage & {
    _id: { toString(): string };
    revision?: { toString(): string };
  };
};

/** A lightweight VaultNamespaceMapper stub. */
const buildMapper = (namespaces: string[]) => ({
  computeAccessibleNamespaces: vi.fn(),
  computePageNamespaces: vi.fn().mockReturnValue({ current: namespaces }),
});

/**
 * Build an async iterable simulating a Mongoose cursor that yields the given pages.
 */
const buildCursor = (pages: ReturnType<typeof buildPage>[]) => {
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        next() {
          if (index < pages.length) {
            return Promise.resolve({
              value: pages[index++],
              done: false as const,
            });
          }
          return Promise.resolve({ value: undefined, done: true as const });
        },
      };
    },
  };
};

/**
 * Build a minimal VaultSyncState document that the resilience layer expects.
 *
 * The runner's readSingleton() returns this via VaultSyncState.findOne().lean().
 * Fields required by the runner:
 *   - bootstrapState: current state
 *   - bootstrapCursor: resume cursor (null for fresh starts)
 *   - bootstrapRetryAttempts: retry count (0 for fresh starts)
 *   - bootstrapRetryAborted: abort flag (false for fresh starts)
 *   - bootstrapHeartbeatAt: null (not stale by default — state != 'running')
 *   - bootstrapInstanceId: null
 */
const buildSyncStateDoc = (
  state:
    | 'pending'
    | 'running'
    | 'done'
    | 'failed'
    | 'retrying'
    | 'escalated' = 'pending',
  cursor: object | null = null,
  overrides: Record<string, unknown> = {},
) => ({
  _id: 'singleton',
  bootstrapState: state,
  bootstrapCursor: cursor,
  bootstrapProcessed: 0,
  bootstrapTotalEstimated: null,
  bootstrapStartedAt: null,
  bootstrapCompletedAt: null,
  bootstrapLastError: null,
  bootstrapInstanceId: null,
  bootstrapHeartbeatAt: null,
  bootstrapLastTriggerSource: null,
  bootstrapRetryAttempts: 0,
  bootstrapRetryNextAt: null,
  bootstrapRetryAborted: false,
  bootstrapCompletenessLastCheckedAt: null,
  bootstrapCompletenessLastResult: null,
  bootstrapStreamSnapshotMaxId: null,
  driftLastWatermark: null,
  driftLastSweepAt: null,
  driftDetectedSinceBoot: 0,
  driftRepairsEmittedSinceBoot: 0,
  driftLastError: null,
  ...overrides,
});

/**
 * Configure the VaultSyncState mock to simulate a given bootstrap state.
 *
 * The resilience layer runner reads state via findOne().lean() (not findOneAndUpdate).
 * Multiple findOne calls occur per bootstrap run:
 *   1. readSingleton() at the start of bootstrap()
 *   2. heartbeat.detectStaleRunning() (also uses findOne)
 *   3. readSingleton() inside executeBootstrap() for forceWipe path
 *
 * We use mockResolvedValue (not mockResolvedValueOnce) so that all findOne calls
 * return the same state, which is sufficient for most test scenarios.
 */
const setupSyncState = async (
  state: 'pending' | 'running' | 'done' | 'failed' = 'pending',
  cursor: object | null = null,
) => {
  const VaultSyncState = await getVaultSyncState();
  const doc = buildSyncStateDoc(state, cursor);
  vi.mocked(VaultSyncState.findOne).mockReturnValue({
    lean: vi.fn().mockResolvedValue(doc),
  } as never);
  vi.mocked(VaultSyncState.findOneAndUpdate).mockResolvedValue(doc as never);
  vi.mocked(VaultSyncState.updateOne).mockResolvedValue({} as never);
};

/**
 * Configure the mocked mongoose.model('Page') to return a minimal Page model stub.
 */
const setupPageModel = async (
  pages: ReturnType<typeof buildPage>[],
  opts: { cursor?: object; findOneSpy?: ReturnType<typeof vi.fn> } = {},
) => {
  const mongoose = await getMongoose();
  const cursorObj = opts.cursor ?? buildCursor(pages);
  const findOneMock = opts.findOneSpy ?? vi.fn().mockResolvedValue(null);
  vi.mocked(mongoose.model).mockReturnValue({
    estimatedDocumentCount: vi.fn().mockResolvedValue(pages.length),
    find: vi.fn().mockReturnValue({
      cursor: vi.fn().mockReturnValue(cursorObj),
    }),
    findOne: findOneMock,
  } as never);
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultBootstrapper', () => {
  let instructionCreateSpy: MockInstance;

  beforeEach(async () => {
    const VaultInstruction = await getVaultInstruction();
    instructionCreateSpy = vi
      .mocked(VaultInstruction.create)
      .mockResolvedValue({ _id: { toString: () => 'instr-id-001' } } as never);
    // Completeness check: findOne must resolve the last instruction with
    // processedAt set (vault-manager processed it) so the poll exits quickly.
    vi.mocked(VaultInstruction.findOne).mockResolvedValue({
      _id: { toString: () => 'instr-id-001' },
      processedAt: new Date(),
    } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // reset-all instruction is issued first
  // -------------------------------------------------------------------------

  describe('reset-all instruction', () => {
    it('issues a reset-all instruction as the first vault_instruction', async () => {
      await setupSyncState('pending');
      const pages = [buildPage({ path: '/page1' })];
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      // The first instruction created should be reset-all
      const firstCall = instructionCreateSpy.mock.calls[0][0];
      expect(firstCall.op).toBe('reset-all');
    });

    it('issues reset-all before any bulk-upsert instruction', async () => {
      await setupSyncState('pending');
      const pages = [buildPage({ path: '/page1' })];
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const callOps = instructionCreateSpy.mock.calls.map((c) => c[0].op);
      const resetIdx = callOps.indexOf('reset-all');
      const bulkIdx = callOps.indexOf('bulk-upsert');

      // reset-all must appear (and before any bulk-upsert if bulk-upsert exists)
      expect(resetIdx).toBeGreaterThanOrEqual(0);
      if (bulkIdx >= 0) {
        expect(resetIdx).toBeLessThan(bulkIdx);
      }
    });
  });

  // -------------------------------------------------------------------------
  // bulk-upsert instructions from pages cursor
  // -------------------------------------------------------------------------

  describe('bulk-upsert instructions from pages cursor', () => {
    it('groups pages by namespace when emitting bulk-upsert', async () => {
      await setupSyncState('pending');

      const pageA = buildPage({
        _id: { toString: () => 'id-a' },
        path: '/a',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const pageB = buildPage({
        _id: { toString: () => 'id-b' },
        path: '/b',
        grant: PageGrant.GRANT_PUBLIC,
      });

      await setupPageModel([pageA, pageB]);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');

      // Both pages go into 'public' namespace — they accumulate in one buffer
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      // After flush, there should be exactly one bulk-upsert for 'public'
      const bulkCalls = instructionCreateSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      expect(bulkCalls).toHaveLength(1);
      expect(bulkCalls[0][0].payload.namespace).toBe('public');
      expect(bulkCalls[0][0].payload.entries).toHaveLength(2);
    });

    it('emits separate bulk-upsert instructions for different namespaces', async () => {
      await setupSyncState('pending');

      const pagePublic = buildPage({
        _id: { toString: () => 'id-pub' },
        path: '/pub',
        grant: PageGrant.GRANT_PUBLIC,
      });
      const pageGroup = buildPage({
        _id: { toString: () => 'id-grp' },
        path: '/grp',
        grant: PageGrant.GRANT_USER_GROUP,
      });

      await setupPageModel([pagePublic, pageGroup]);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');

      const mapper = {
        computeAccessibleNamespaces: vi.fn(),
        computePageNamespaces: vi
          .fn()
          .mockReturnValueOnce({ current: ['public'] })
          .mockReturnValueOnce({ current: ['group-g1'] }),
      };
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const bulkCalls = instructionCreateSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      const namespaces = bulkCalls.map((c) => c[0].payload.namespace);
      expect(namespaces).toContain('public');
      expect(namespaces).toContain('group-g1');
    });
  });

  // -------------------------------------------------------------------------
  // CHUNK_SIZE boundary behaviour
  // -------------------------------------------------------------------------

  describe('CHUNK_SIZE boundary behaviour', () => {
    it('does NOT flush mid-stream when exactly CHUNK_SIZE - 1 (999) pages exist', async () => {
      await setupSyncState('pending');

      const pages = Array.from({ length: 999 }, (_, i) =>
        buildPage({ _id: { toString: () => `id-${i}` }, path: `/p${i}` }),
      );
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      // All 999 pages should be in one remaining-buffer flush (no mid-stream flush)
      const bulkCalls = instructionCreateSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      // Exactly 1 bulk-upsert (the remaining-buffer flush)
      expect(bulkCalls).toHaveLength(1);
      expect(bulkCalls[0][0].payload.entries).toHaveLength(999);
    });

    it('flushes exactly once mid-stream when exactly CHUNK_SIZE (1000) pages exist', async () => {
      await setupSyncState('pending');

      const pages = Array.from({ length: 1000 }, (_, i) =>
        buildPage({ _id: { toString: () => `id-${i}` }, path: `/p${i}` }),
      );
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const bulkCalls = instructionCreateSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      // The buffer flushes when it hits 1000 entries; the remaining buffer is empty → 1 call
      expect(bulkCalls).toHaveLength(1);
      expect(bulkCalls[0][0].payload.entries).toHaveLength(1000);
    });

    it('flushes once mid-stream and once for remainder when CHUNK_SIZE + 1 (1001) pages exist', async () => {
      await setupSyncState('pending');

      const pages = Array.from({ length: 1001 }, (_, i) =>
        buildPage({ _id: { toString: () => `id-${i}` }, path: `/p${i}` }),
      );
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const bulkCalls = instructionCreateSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      // First flush: 1000 entries (mid-stream), second flush: 1 entry (remainder)
      expect(bulkCalls).toHaveLength(2);
      const entryCounts = bulkCalls
        .map((c) => c[0].payload.entries.length)
        .sort((a, b) => b - a);
      expect(entryCounts[0]).toBe(1000);
      expect(entryCounts[1]).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // bootstrapState transitions
  // -------------------------------------------------------------------------

  describe('bootstrapState transitions', () => {
    it('sets bootstrapState to done after successful completion', async () => {
      await setupSyncState('pending');
      await setupPageModel([buildPage()]);

      const VaultSyncState = await getVaultSyncState();
      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const updateCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const doneCall = updateCalls.find(
        (c) =>
          (c[1] as UpdateQuery<VaultSyncStateDocument>).$set?.bootstrapState ===
          'done',
      );
      expect(doneCall).toBeDefined();
      const doneUpdate = doneCall?.[1] as UpdateQuery<VaultSyncStateDocument>;
      expect(doneUpdate.$set?.bootstrapCompletedAt).toBeInstanceOf(Date);
    });

    it('sets bootstrapState to failed and records lastError when an exception is thrown during streaming', async () => {
      await setupSyncState('pending');

      // Make the Page cursor throw during iteration (inside the runner's try/catch block)
      const throwingCursor = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<never> {
              return Promise.reject(new Error('DB down'));
            },
          };
        },
      };

      const mongoose = await getMongoose();
      vi.mocked(mongoose.model).mockReturnValue({
        estimatedDocumentCount: vi.fn().mockResolvedValue(0),
        find: vi
          .fn()
          .mockReturnValue({ cursor: vi.fn().mockReturnValue(throwingCursor) }),
        findOne: vi.fn().mockResolvedValue(null),
      } as never);

      const VaultSyncState = await getVaultSyncState();
      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const updateCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const failedCall = updateCalls.find(
        (c) =>
          (c[1] as UpdateQuery<VaultSyncStateDocument>).$set?.bootstrapState ===
          'failed',
      );
      expect(failedCall).toBeDefined();
      const failedUpdate =
        failedCall?.[1] as UpdateQuery<VaultSyncStateDocument>;
      expect(failedUpdate.$set?.bootstrapLastError).toBe('DB down');
    });
  });

  // -------------------------------------------------------------------------
  // Resume from bootstrapCursor
  //
  // NOTE: env-driven resume (env-true triggerSource → resumeFromCursor when
  // state='failed' with retryAllowed=true) is covered at the bootstrap-runner
  // unit test level. Bootstrapper integration tests below only cover the
  // forceWipe path (admin-force-wipe), which always resets the cursor.
  // -------------------------------------------------------------------------

  describe('resume from bootstrapCursor', () => {
    it('does NOT apply _id filter when bootstrapCursor is null', async () => {
      await setupSyncState('pending', null);

      const pages = [buildPage()];
      const mongoose = await getMongoose();
      const findMock = vi.fn().mockReturnValue({
        cursor: vi.fn().mockReturnValue(buildCursor(pages)),
      });
      vi.mocked(mongoose.model).mockReturnValue({
        estimatedDocumentCount: vi.fn().mockResolvedValue(1),
        find: findMock,
        findOne: vi.fn().mockResolvedValue(null),
      } as never);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      // The find() call must NOT include an _id filter
      const query = findMock.mock.calls[0][0];
      expect(query).not.toHaveProperty('_id');
    });
  });

  // -------------------------------------------------------------------------
  // Double-start prevention
  // -------------------------------------------------------------------------

  // NOTE: env-driven skip-when-running, skip-when-done, and aborted-skip
  // behaviors are covered at the bootstrap-runner unit test level. Removed
  // from here because they required the `start()` method that has since
  // been retired (see VaultBootstrapper interface change).

  // -------------------------------------------------------------------------
  // Null revision skip
  // -------------------------------------------------------------------------

  describe('null revision skip', () => {
    it('does NOT include a page with revision == null in any bulk-upsert payload', async () => {
      await setupSyncState('pending');

      const pageWithRevision = buildPage({
        _id: { toString: () => 'id-with-rev' },
        path: '/with-revision',
        revision: { toString: () => 'rev-abc' } as never,
      });
      const pageWithoutRevision = buildPage({
        _id: { toString: () => 'id-no-rev' },
        path: '/no-revision',
        revision: undefined,
      });

      await setupPageModel([pageWithRevision, pageWithoutRevision]);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const bulkCalls = instructionCreateSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      const allEntries = bulkCalls.flatMap(
        (c) => c[0].payload.entries as { pageId: string; revisionId: string }[],
      );

      // The page with a valid revision must appear
      expect(allEntries.some((e) => e.pageId === 'id-with-rev')).toBe(true);

      // The page without a revision must NOT appear
      expect(allEntries.some((e) => e.pageId === 'id-no-rev')).toBe(false);

      // No entry should have an empty revisionId
      expect(allEntries.every((e) => e.revisionId !== '')).toBe(true);
    });

    it('increments bootstrapProcessed for both skipped and non-skipped pages', async () => {
      await setupSyncState('pending');

      const VaultSyncState = await getVaultSyncState();

      const pageWithRevision = buildPage({
        _id: { toString: () => 'id-with-rev' },
        path: '/with-revision',
        revision: { toString: () => 'rev-abc' } as never,
      });
      const pageWithoutRevision = buildPage({
        _id: { toString: () => 'id-no-rev' },
        path: '/no-revision',
        revision: undefined,
      });

      await setupPageModel([pageWithRevision, pageWithoutRevision]);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      // Find all updateOne calls that set bootstrapProcessed
      const updateCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const processedValues = updateCalls
        .filter(
          (c) =>
            (c[1] as UpdateQuery<VaultSyncStateDocument>).$set
              ?.bootstrapProcessed != null,
        )
        .map(
          (c) =>
            (c[1] as UpdateQuery<VaultSyncStateDocument>).$set!
              .bootstrapProcessed as number,
        );

      // bootstrapProcessed should reach 2 (both pages counted, including skipped)
      expect(Math.max(...processedValues)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  describe('getStatus', () => {
    it('returns pending status with zero values when no sync state document exists', async () => {
      const VaultSyncState = await getVaultSyncState();
      vi.mocked(VaultSyncState.findOne).mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as never);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const bootstrapper = createVaultBootstrapper(buildMapper(['public']));

      const status = await bootstrapper.getStatus();

      expect(status.state).toBe('pending');
      expect(status.processed).toBe(0);
      expect(status.totalEstimated).toBeNull();
      expect(status.cursor).toBeNull();
      expect(status.startedAt).toBeNull();
      expect(status.completedAt).toBeNull();
      expect(status.lastError).toBeNull();
    });

    it('returns the current sync state when a document exists', async () => {
      const startedAt = new Date('2024-01-01T00:00:00Z');
      const VaultSyncState = await getVaultSyncState();
      vi.mocked(VaultSyncState.findOne).mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          bootstrapState: 'running',
          bootstrapProcessed: 42,
          bootstrapTotalEstimated: 100,
          bootstrapCursor: { toString: () => 'cursor-xyz' },
          bootstrapStartedAt: startedAt,
          bootstrapCompletedAt: null,
          bootstrapLastError: null,
          bootstrapInstanceId: 'inst-001',
          bootstrapHeartbeatAt: new Date(),
          bootstrapLastTriggerSource: 'admin-force-wipe',
          bootstrapRetryAttempts: 0,
          bootstrapRetryNextAt: null,
          bootstrapRetryAborted: false,
          bootstrapCompletenessLastCheckedAt: null,
          bootstrapCompletenessLastResult: null,
          bootstrapStreamSnapshotMaxId: null,
          driftLastWatermark: null,
          driftLastSweepAt: null,
          driftDetectedSinceBoot: 0,
          driftRepairsEmittedSinceBoot: 0,
          driftLastError: null,
        }),
      } as never);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const bootstrapper = createVaultBootstrapper(buildMapper(['public']));

      const status = await bootstrapper.getStatus();

      expect(status.state).toBe('running');
      expect(status.processed).toBe(42);
      expect(status.totalEstimated).toBe(100);
      expect(status.cursor).toBe('cursor-xyz');
      expect(status.startedAt).toBe(startedAt);
      expect(status.completedAt).toBeNull();
      expect(status.lastError).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Delegation to resilience layer
  // -------------------------------------------------------------------------

  describe('delegation to resilience layer', () => {
    it('getStatus() returns a BootstrapStatus with all required fields', async () => {
      const VaultSyncState = await getVaultSyncState();
      vi.mocked(VaultSyncState.findOne).mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as never);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const bootstrapper = createVaultBootstrapper(buildMapper(['public']));

      const status = await bootstrapper.getStatus();

      // Verify all BootstrapStatus fields are present (backward compat shape)
      expect(status).toHaveProperty('state');
      expect(status).toHaveProperty('processed');
      expect(status).toHaveProperty('totalEstimated');
      expect(status).toHaveProperty('cursor');
      expect(status).toHaveProperty('startedAt');
      expect(status).toHaveProperty('completedAt');
      expect(status).toHaveProperty('lastError');
    });

    // NOTE: triggerSource → envValue mapping (env-true vs env-force vs
    // admin-force-wipe) is verified at the bootstrap-runner unit test level
    // via `triggerSourceToEnvValue`. Removed from here because the
    // bootstrapper.start({ env-var }) entry that this test relied on no
    // longer exists.
  });

  // -------------------------------------------------------------------------
  // wipeAndRebootstrap (kill switch)
  // -------------------------------------------------------------------------

  describe('wipeAndRebootstrap', () => {
    it('issues reset-all even from done state (force wipe)', async () => {
      // State is 'done' — start() with env-true would skip. wipeAndRebootstrap
      // must always proceed regardless of current state.
      await setupSyncState('done');
      const pages = [buildPage({ path: '/page1' })];
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const ops = instructionCreateSpy.mock.calls.map((c) => c[0].op);
      expect(ops).toContain('reset-all');
    });

    it('seeds bulk-upsert instructions after reset-all', async () => {
      await setupSyncState('done');
      const pages = [
        buildPage({ path: '/page1', grant: PageGrant.GRANT_PUBLIC }),
      ];
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const mapper = buildMapper(['public']);
      const bootstrapper = createVaultBootstrapper(mapper);

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
      });

      const callOps = instructionCreateSpy.mock.calls.map((c) => c[0].op);
      const resetIdx = callOps.indexOf('reset-all');
      const bulkIdx = callOps.indexOf('bulk-upsert');
      expect(resetIdx).toBeGreaterThanOrEqual(0);
      if (bulkIdx >= 0) {
        expect(resetIdx).toBeLessThan(bulkIdx);
      }
    });
  });

  // -------------------------------------------------------------------------
  // onRunning handshake — HTTP routes use this to return 202 as soon as
  // state='running' is durably committed, without waiting for the full
  // bootstrap stream to finish.
  // -------------------------------------------------------------------------

  describe('onRunning callback', () => {
    it('wipeAndRebootstrap fires onRunning before the page stream emits bulk-upsert', async () => {
      // The callback fires after state='running' + reset-all are persisted
      // but before bulk-upsert instructions are emitted from the page
      // stream. Tests observe this by counting bulk-upsert at the moment
      // onRunning fires.
      await setupSyncState('done');
      const pages = [
        buildPage({ path: '/page1', grant: PageGrant.GRANT_PUBLIC }),
      ];
      await setupPageModel(pages);

      const { createVaultBootstrapper } = await import('./vault-bootstrapper');
      const bootstrapper = createVaultBootstrapper(buildMapper(['public']));

      let bulkUpsertCountAtCallback = -1;
      const onRunning = vi.fn(() => {
        bulkUpsertCountAtCallback = instructionCreateSpy.mock.calls.filter(
          (c) => c[0]?.op === 'bulk-upsert',
        ).length;
      });

      await bootstrapper.wipeAndRebootstrap({
        triggerSource: 'admin-force-wipe',
        onRunning,
      });

      expect(onRunning).toHaveBeenCalledTimes(1);
      expect(bulkUpsertCountAtCallback).toBe(0);
    });

    // NOTE: env-driven onRunning behavior (fires for env-true with state
    // transition, does NOT fire when env-true skips because state='done') is
    // covered at the bootstrap-runner unit test level. The admin-ui variant
    // (functionally identical to admin-force-wipe) was removed along with
    // the Prepare button — the wipeAndRebootstrap test above is sufficient.
  });
});
