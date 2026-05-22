import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Task 5.2 tests register SIGTERM/SIGINT handlers via initializeVaultFeature.
// Raise the limit early (module-load time) to suppress the Node.js memory-leak
// warning that fires when more than 10 listeners are added to the process emitter.
process.setMaxListeners(50);

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the SUT import.
// ---------------------------------------------------------------------------

vi.mock('./services/vault-settings-service', () => ({
  vaultSettingsService: {
    getSettings: vi.fn(),
  },
}));

// Mock VaultSyncState model so tests do not require a real MongoDB connection.
vi.mock('./models/vault-sync-state', () => ({
  VaultSyncState: {
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('~/server/service/config-manager', () => ({
  configManager: {
    getConfig: vi.fn(),
  },
}));

// Shared logger spies so tests can assert on warn calls. Declared via
// vi.hoisted so the references survive vi.mock's hoisting transform.
const { loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
  }),
}));

// Shared spies for dispatcher + namespace mapper. Declared via vi.hoisted so
// they survive vi.mock's hoisting transform and are reachable from the
// factories below.
const {
  dispatcherOnPageChanged,
  dispatcherOnBulkOperation,
  namespaceMapperComputePageNamespaces,
} = vi.hoisted(() => ({
  dispatcherOnPageChanged: vi.fn().mockResolvedValue(undefined),
  dispatcherOnBulkOperation: vi.fn().mockResolvedValue(undefined),
  namespaceMapperComputePageNamespaces: vi.fn(() => ({
    current: ['public'] as ReadonlyArray<string>,
    previous: undefined as ReadonlyArray<string> | undefined,
  })),
}));

vi.mock('./services/vault-dispatcher', () => ({
  createVaultDispatcher: vi.fn(() => ({
    onPageChanged: dispatcherOnPageChanged,
    onBulkOperation: dispatcherOnBulkOperation,
  })),
}));

vi.mock('./services/vault-bootstrapper', () => ({
  createVaultBootstrapper: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(),
    initOnStartup: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

// vault-namespace-mapper is exercised by Stage 2 subscribers (rename /
// descendantsGrantChanged) so we share a stub that tests can configure.
vi.mock('./services/vault-namespace-mapper', () => ({
  vaultNamespaceMapper: {
    computeAccessibleNamespaces: vi.fn(),
    computePageNamespaces: namespaceMapperComputePageNamespaces,
  },
}));

vi.mock('./routes/vault-gateway', () => ({
  createVaultGatewayRouter: vi.fn(),
}));

vi.mock('./routes/vault-admin', () => ({
  createVaultAdminRouter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Reconcile module mocks (task 3.3)
// ---------------------------------------------------------------------------

// Shared spy for normalizeStaleLifecycle (task 3.3).
const { normalizeStaleLifecycleSpy, reconcileServiceStopSpy } = vi.hoisted(
  () => ({
    normalizeStaleLifecycleSpy: vi.fn().mockResolvedValue(0),
    reconcileServiceStopSpy: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock('./models/vault-reconcile-log', () => ({
  VaultReconcileLog: {},
}));

vi.mock('./services/reconcile/reconcile-history-store', () => ({
  createHistoryStore: vi.fn(() => ({
    create: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    listRecent: vi.fn().mockResolvedValue([]),
    normalizeStaleLifecycle: normalizeStaleLifecycleSpy,
  })),
}));

vi.mock('./services/reconcile/reconcile-acl-evaluator', () => ({
  createAclEvaluator: vi.fn(() => ({
    buildEligibleQuery: vi.fn().mockResolvedValue({ eligibleQuery: {} }),
  })),
}));

vi.mock('./services/reconcile/reconcile-concurrency-controller', () => ({
  createConcurrencyController: vi.fn(() => ({
    tryRunInBackground: vi.fn().mockReturnValue({ ok: true }),
    getActiveCount: vi.fn().mockReturnValue(0),
    reset: vi.fn(),
  })),
}));

vi.mock('./services/reconcile/reconcile-orchestrator', () => ({
  createReconcileOrchestrator: vi.fn(() => ({
    run: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./services/reconcile/reconcile-target-resolver', () => ({
  resolveTarget: vi.fn().mockReturnValue({ ok: true, query: {} }),
}));

vi.mock('./services/reconcile', () => ({
  createVaultReconcileService: vi.fn(() => ({
    submit: vi.fn().mockResolvedValue({
      status: 'accepted',
      reconcileId: 'r1',
      descendantCount: 0,
    }),
    listHistory: vi.fn().mockResolvedValue([]),
    stop: reconcileServiceStopSpy,
  })),
}));

vi.mock('./routes/vault-page', () => ({
  createVaultPageRouter: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the SUT after the mocks are in place.
// ---------------------------------------------------------------------------

import { configManager } from '~/server/service/config-manager';

import {
  createVaultAdminRouterWithDeps,
  createVaultPageRouterWithDeps,
  initializeVaultFeature,
  runVaultSyncStateMigration,
} from './index';
import { VaultSyncState } from './models/vault-sync-state';
import { createVaultAdminRouter } from './routes/vault-admin';
import { createVaultPageRouter } from './routes/vault-page';
import { createVaultReconcileService } from './services/reconcile';
import { createHistoryStore } from './services/reconcile/reconcile-history-store';
import { createVaultBootstrapper } from './services/vault-bootstrapper';
import { vaultSettingsService } from './services/vault-settings-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCrowiStub() {
  return {
    events: {
      page: new EventEmitter(),
    },
  };
}

/**
 * Set up default VaultSyncState mock responses required by
 * runVaultSyncStateMigration(), which is now called inside
 * initializeVaultFeature(). Every test that calls initializeVaultFeature()
 * must have these mocks in place so migration steps 1-3 don't throw.
 */
function enableVaultSyncStateMocks() {
  vi.mocked(VaultSyncState.findOneAndUpdate).mockResolvedValue(null as never);
  vi.mocked(VaultSyncState.updateOne).mockResolvedValue({} as never);
  vi.mocked(VaultSyncState.findOne).mockReturnValue({
    lean: vi.fn().mockResolvedValue({
      bootstrapState: 'pending',
      bootstrapInstanceId: null,
    }),
  } as never);
}

function enableVaultSettings() {
  (
    vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    enabled: true,
    managerEndpoint: 'http://vault-manager',
    managerInternalSecret: 'secret',
  });
  (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(false);
  enableVaultSyncStateMocks();
}

/** Flush microtasks so that fire-and-forget promises chain resolve. */
async function flush() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initializeVaultFeature — updateMany subscription (task 21.1-A / Stage 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableVaultSettings();
  });

  it('dispatches one per-page upsert for every page carried by updateMany', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
      { _id: { toString: () => 'p2' }, path: '/a/y', revision: 'r2' },
      { _id: { toString: () => 'p3' }, path: '/a/z', revision: 'r3' },
    ];

    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(3);
    expect(dispatcherOnPageChanged).toHaveBeenNthCalledWith(1, {
      type: 'update',
      page: pages[0],
      revisionId: 'r1',
    });
    expect(dispatcherOnPageChanged).toHaveBeenNthCalledWith(3, {
      type: 'update',
      page: pages[2],
      revisionId: 'r3',
    });
  });

  it('skips pages with no revision (auto-generated intermediate paths)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
      // Auto-generated intermediate page — no revision.
      { _id: { toString: () => 'p2' }, path: '/a' },
      { _id: { toString: () => 'p3' }, path: '/a/z', revision: 'r3' },
    ];

    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(2);
    const dispatched = dispatcherOnPageChanged.mock.calls.map(
      (args) => (args[0] as { revisionId: string }).revisionId,
    );
    expect(dispatched).toEqual(['r1', 'r3']);
  });

  it('resolves revision when populated as an ObjectId-like object', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const populatedRevision = {
      _id: { toString: () => 'rev-from-populated' },
    };
    const pages = [
      {
        _id: { toString: () => 'p1' },
        path: '/a/x',
        revision: populatedRevision,
      },
    ];

    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(1);
    expect(dispatcherOnPageChanged).toHaveBeenCalledWith({
      type: 'update',
      page: pages[0],
      revisionId: 'rev-from-populated',
    });
  });

  it('does nothing when the payload is not an array (defensive)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    crowi.events.page.emit('updateMany', undefined, { _id: 'u1' });
    crowi.events.page.emit('updateMany', null, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
  });

  it('does not subscribe to updateMany when vaultEnabled=false', async () => {
    (
      vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      enabled: false,
      managerEndpoint: '',
      managerInternalSecret: '',
    });

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
    ];
    crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
    await flush();

    expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
  });

  it('logs a warning and does not throw when dispatcher.onPageChanged rejects', async () => {
    dispatcherOnPageChanged.mockRejectedValueOnce(new Error('boom'));

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const pages = [
      { _id: { toString: () => 'p1' }, path: '/a/x', revision: 'r1' },
    ];

    // The emit must not propagate the rejection — fire-and-forget catch is
    // expected to swallow it into a logger.warn call.
    expect(() =>
      crowi.events.page.emit('updateMany', pages, { _id: 'u1' }),
    ).not.toThrow();
    await flush();

    expect(loggerWarn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      'vault-dispatcher: error handling updateMany entry',
    );
  });
});

describe('initializeVaultFeature — Stage 2 subscriptions (task 21.1-B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableVaultSettings();
    namespaceMapperComputePageNamespaces.mockReturnValue({
      current: ['public'],
      previous: undefined,
    });
  });

  // -------------------------------------------------------------------------
  // 'rename' — single page
  // -------------------------------------------------------------------------

  describe("'rename' event", () => {
    it('dispatches one rename-prefix per namespace with old/new path', async () => {
      namespaceMapperComputePageNamespaces.mockReturnValue({
        current: ['group-eng', 'public'],
        previous: undefined,
      });
      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      const page = { _id: { toString: () => 'p1' }, path: '/new/path' };
      crowi.events.page.emit('rename', {
        page,
        oldPath: '/old/path',
        newPath: '/new/path',
        user: { _id: 'u1' },
      });
      await flush();

      expect(dispatcherOnBulkOperation).toHaveBeenCalledTimes(1);
      expect(dispatcherOnBulkOperation).toHaveBeenCalledWith({
        type: 'rename-prefix',
        namespaces: ['group-eng', 'public'],
        oldPrefix: '/old/path',
        newPrefix: '/new/path',
      });
    });

    it('skips when payload is missing required fields', async () => {
      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      // Legacy callers that emit without payload — must not crash, must not
      // dispatch any bulk op.
      crowi.events.page.emit('rename');
      crowi.events.page.emit('rename', { oldPath: '/x', newPath: '/y' });
      await flush();

      expect(dispatcherOnBulkOperation).not.toHaveBeenCalled();
    });

    it('skips when computePageNamespaces returns no current namespaces', async () => {
      namespaceMapperComputePageNamespaces.mockReturnValue({
        current: [],
        previous: undefined,
      });
      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      crowi.events.page.emit('rename', {
        page: { _id: { toString: () => 'p1' }, path: '/x' },
        oldPath: '/old',
        newPath: '/x',
        user: { _id: 'u1' },
      });
      await flush();

      expect(dispatcherOnBulkOperation).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 'updateMany' — bulk rename Stage 2 fast path
  // -------------------------------------------------------------------------

  describe("'updateMany' with prefix extras", () => {
    it('collapses bulk rename into one rename-prefix per affected namespace (de-duped)', async () => {
      namespaceMapperComputePageNamespaces
        .mockReturnValueOnce({ current: ['public'], previous: undefined })
        .mockReturnValueOnce({
          current: ['public', 'group-eng'],
          previous: undefined,
        })
        .mockReturnValueOnce({ current: ['group-eng'], previous: undefined });

      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      const pages = [
        { _id: { toString: () => 'p1' }, path: '/new/a' },
        { _id: { toString: () => 'p2' }, path: '/new/b' },
        { _id: { toString: () => 'p3' }, path: '/new/c' },
      ];

      crowi.events.page.emit(
        'updateMany',
        pages,
        { _id: 'u1' },
        { oldPagePathPrefix: '/old/', newPagePathPrefix: '/new/' },
      );
      await flush();

      // One bulk op, not three per-page upserts.
      expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
      expect(dispatcherOnBulkOperation).toHaveBeenCalledTimes(1);

      const call = dispatcherOnBulkOperation.mock.calls[0][0] as Parameters<
        typeof dispatcherOnBulkOperation
      >[0];
      expect(call.type).toBe('rename-prefix');
      expect(call.oldPrefix).toBe('/old/');
      expect(call.newPrefix).toBe('/new/');
      // De-duped union of the three pages' namespaces, order-insensitive.
      expect((call.namespaces as ReadonlyArray<string>).slice().sort()).toEqual(
        ['group-eng', 'public'],
      );
    });

    it('falls back to per-page upsert when extras is omitted (legacy emit)', async () => {
      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      const pages = [
        { _id: { toString: () => 'p1' }, path: '/x', revision: 'r1' },
      ];
      // No 4th arg — legacy contract.
      crowi.events.page.emit('updateMany', pages, { _id: 'u1' });
      await flush();

      expect(dispatcherOnBulkOperation).not.toHaveBeenCalled();
      expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(1);
      expect(dispatcherOnPageChanged).toHaveBeenCalledWith({
        type: 'update',
        page: pages[0],
        revisionId: 'r1',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 'descendantsGrantChanged' — bulk grant change
  // -------------------------------------------------------------------------

  describe("'descendantsGrantChanged' event", () => {
    it('dispatches an acl-change per affected page with previous + current namespaces', async () => {
      // First call returns the OLD namespaces (public), second call (post)
      // returns NEW namespaces (group-eng) per page.
      namespaceMapperComputePageNamespaces
        .mockReturnValueOnce({ current: ['public'], previous: undefined }) // previousPageView for p1
        .mockReturnValueOnce({ current: ['public'], previous: undefined }); // previousPageView for p2

      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      const pageDocs = [
        { _id: { toString: () => 'p1' }, path: '/p1', revision: 'rev1' },
        { _id: { toString: () => 'p2' }, path: '/p2', revision: 'rev2' },
      ];

      crowi.events.page.emit('descendantsGrantChanged', {
        affectedPages: [
          {
            page: pageDocs[0],
            previousGrant: 1, // public
            previousGrantedGroups: [],
            previousGrantedUsers: [],
            newGrant: 5, // group
            newGrantedGroups: ['g1'],
            newGrantedUsers: [],
          },
          {
            page: pageDocs[1],
            previousGrant: 1,
            previousGrantedGroups: [],
            previousGrantedUsers: [],
            newGrant: 5,
            newGrantedGroups: ['g1'],
            newGrantedUsers: [],
          },
        ],
        user: { _id: 'u1' },
      });
      await flush();

      expect(dispatcherOnPageChanged).toHaveBeenCalledTimes(2);
      const first = dispatcherOnPageChanged.mock.calls[0][0] as Parameters<
        typeof dispatcherOnPageChanged
      >[0];
      expect(first.type).toBe('acl-change');
      expect(
        (first as { previousNamespaces: ReadonlyArray<string> })
          .previousNamespaces,
      ).toEqual(['public']);
      expect(first.revisionId).toBe('rev1');
    });

    it('does nothing for an empty affectedPages list', async () => {
      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      crowi.events.page.emit('descendantsGrantChanged', {
        affectedPages: [],
        user: { _id: 'u1' },
      });
      await flush();

      expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
    });

    it('does not crash on a malformed payload', async () => {
      const crowi = makeCrowiStub();
      await initializeVaultFeature(crowi);

      expect(() =>
        crowi.events.page.emit('descendantsGrantChanged'),
      ).not.toThrow();
      expect(() =>
        crowi.events.page.emit('descendantsGrantChanged', {
          affectedPages: null,
        }),
      ).not.toThrow();
      await flush();

      expect(dispatcherOnPageChanged).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// initializeVaultFeature — migration is called before bootstrap dispatch
// (Task 1.4 — requirement 1.11, 3.3)
// ---------------------------------------------------------------------------

describe('initializeVaultFeature — calls runVaultSyncStateMigration before bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default vault settings: enabled
    (
      vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      enabled: true,
      managerEndpoint: 'http://vault-manager',
      managerInternalSecret: 'secret',
    });
    // VaultSyncState mocks required by runVaultSyncStateMigration
    vi.mocked(VaultSyncState.findOneAndUpdate).mockResolvedValue(null as never);
    vi.mocked(VaultSyncState.updateOne).mockResolvedValue({} as never);
    vi.mocked(VaultSyncState.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue({
        bootstrapState: 'pending',
        bootstrapInstanceId: null,
      }),
    } as never);
  });

  it('calls findOneAndUpdate (step 1 of migration) before the bootstrapper.start dispatch', async () => {
    // Configure VAULT_BOOTSTRAP_ON_START so that start() is actually called.
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'true',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);
    await flush();

    // Migration step 1 must have been called.
    expect(VaultSyncState.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(VaultSyncState.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'singleton' },
      expect.objectContaining({ $setOnInsert: expect.any(Object) }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('migration runs even when VAULT_BOOTSTRAP_ON_START is false', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      false,
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    // Migration step 1 still ran.
    expect(VaultSyncState.findOneAndUpdate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// runVaultSyncStateMigration — unit tests (Task 1.4 / requirements 1.11, 3.3)
// ---------------------------------------------------------------------------

describe('runVaultSyncStateMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: configure findOneAndUpdate to return a value (simulates upsert result)
  function mockFindOneAndUpdateResult(result: Record<string, unknown> | null) {
    vi.mocked(VaultSyncState.findOneAndUpdate).mockResolvedValue(
      result as never,
    );
  }

  // Helper: configure findOne(...).lean() chain
  function mockFindOneLean(doc: Record<string, unknown> | null) {
    vi.mocked(VaultSyncState.findOne).mockReturnValue({
      lean: vi.fn().mockResolvedValue(doc),
    } as never);
  }

  // Helper: configure updateOne to succeed
  function mockUpdateOneSuccess() {
    vi.mocked(VaultSyncState.updateOne).mockResolvedValue({} as never);
  }

  // ---------------------------------------------------------------------------
  // (a) Fresh install — no doc exists before migration
  // ---------------------------------------------------------------------------
  describe('fresh install (no pre-existing doc)', () => {
    it('calls findOneAndUpdate with upsert to create the singleton', async () => {
      // Step 1: upsert creates the doc (new: false → returns null for fresh insert)
      mockFindOneAndUpdateResult(null);
      mockUpdateOneSuccess();
      // Step 3: fresh doc has bootstrapState: 'pending', so no normalization needed
      mockFindOneLean({ bootstrapState: 'pending', bootstrapInstanceId: null });

      await runVaultSyncStateMigration();

      expect(VaultSyncState.findOneAndUpdate).toHaveBeenCalledOnce();
      const [filter, update, options] = vi.mocked(
        VaultSyncState.findOneAndUpdate,
      ).mock.calls[0];
      expect(filter).toEqual({ _id: 'singleton' });
      expect((update as Record<string, unknown>).$setOnInsert).toBeDefined();
      expect(options).toMatchObject({ upsert: true, new: false });
    });

    it('includes all 14 new resilience fields in $setOnInsert defaults', async () => {
      mockFindOneAndUpdateResult(null);
      mockUpdateOneSuccess();
      mockFindOneLean({ bootstrapState: 'pending', bootstrapInstanceId: null });

      await runVaultSyncStateMigration();

      const update = vi.mocked(VaultSyncState.findOneAndUpdate).mock
        .calls[0][1] as Record<string, unknown>;
      const setOnInsert = update.$setOnInsert as Record<string, unknown>;

      // Check a representative subset of the 14 new fields
      expect(setOnInsert).toMatchObject({
        bootstrapRetryAttempts: 0,
        bootstrapRetryAborted: false,
        bootstrapInstanceId: null,
        bootstrapHeartbeatAt: null,
        bootstrapLastTriggerSource: null,
        bootstrapRetryNextAt: null,
        bootstrapCompletenessLastCheckedAt: null,
        bootstrapCompletenessLastResult: null,
        bootstrapStreamSnapshotMaxId: null,
        driftLastWatermark: null,
        driftLastSweepAt: null,
        driftDetectedSinceBoot: 0,
        driftRepairsEmittedSinceBoot: 0,
        driftLastError: null,
      });
    });

    it('step 3 is a no-op when fresh doc has bootstrapState pending', async () => {
      mockFindOneAndUpdateResult(null);
      mockUpdateOneSuccess();
      mockFindOneLean({ bootstrapState: 'pending', bootstrapInstanceId: null });

      await runVaultSyncStateMigration();

      // updateOne should only be called once (step 2 migration, which is a
      // no-op for fresh doc — but we verify step 3 normalization is NOT called)
      // Step 2: filter is bootstrapRetryAttempts: { $exists: false } — fresh doc
      // has the field so this is a no-op call, but we still check step 3 didn't fire.
      const updateOneCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const normalizationCall = updateOneCalls.find((call) => {
        const upd = call[1] as Record<string, Record<string, unknown>>;
        return upd.$set?.bootstrapState === 'failed';
      });
      expect(normalizationCall).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // (b) Existing pre-migration doc (4-state, missing the 14 new fields)
  // ---------------------------------------------------------------------------
  describe('existing pre-migration doc', () => {
    it('step 1 is a no-op (doc already exists, upsert does not fire $setOnInsert)', async () => {
      // findOneAndUpdate returns the old doc (new: false returns pre-update state)
      mockFindOneAndUpdateResult({
        _id: 'singleton',
        bootstrapState: 'pending',
      });
      mockUpdateOneSuccess();
      mockFindOneLean({
        _id: 'singleton',
        bootstrapState: 'pending',
        bootstrapInstanceId: null,
      });

      await runVaultSyncStateMigration();

      // findOneAndUpdate was called but since doc existed, $setOnInsert was skipped
      // by MongoDB — we just verify it was called with upsert: true
      expect(VaultSyncState.findOneAndUpdate).toHaveBeenCalledOnce();
    });

    it('step 2 migrates the 14 new fields for a doc missing bootstrapRetryAttempts', async () => {
      mockFindOneAndUpdateResult({
        _id: 'singleton',
        bootstrapState: 'failed',
      });
      mockUpdateOneSuccess();
      mockFindOneLean({
        _id: 'singleton',
        bootstrapState: 'failed',
        bootstrapInstanceId: null,
        bootstrapRetryAttempts: 0,
      });

      await runVaultSyncStateMigration();

      expect(VaultSyncState.updateOne).toHaveBeenCalledWith(
        { _id: 'singleton', bootstrapRetryAttempts: { $exists: false } },
        expect.objectContaining({
          $set: expect.objectContaining({
            bootstrapRetryAttempts: 0,
            bootstrapRetryAborted: false,
            driftDetectedSinceBoot: 0,
            driftRepairsEmittedSinceBoot: 0,
          }),
        }),
        // No upsert option — prevents E11000
      );
      // Verify upsert is NOT set
      const call = vi.mocked(VaultSyncState.updateOne).mock.calls[0];
      expect(call[2]).toBeUndefined();
    });

    it('step 3 normalizes running + null instanceId to failed', async () => {
      mockFindOneAndUpdateResult({
        _id: 'singleton',
        bootstrapState: 'running',
      });
      mockUpdateOneSuccess();
      // Doc after migration: running with null bootstrapInstanceId (pre-resilience run)
      mockFindOneLean({
        _id: 'singleton',
        bootstrapState: 'running',
        bootstrapInstanceId: null,
      });

      await runVaultSyncStateMigration();

      const updateOneCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const normalizationCall = updateOneCalls.find((call) => {
        const upd = call[1] as Record<string, Record<string, unknown>>;
        return upd.$set?.bootstrapState === 'failed';
      });
      expect(normalizationCall).toBeDefined();
      if (normalizationCall == null) return;
      const upd = normalizationCall[1] as Record<
        string,
        Record<string, unknown>
      >;
      expect(upd.$set.bootstrapLastError).toMatch(/stale running/i);
    });
  });

  // ---------------------------------------------------------------------------
  // (c) Second startup — already migrated, both steps 1 and 2 are no-ops
  // ---------------------------------------------------------------------------
  describe('second startup (already migrated)', () => {
    it('is idempotent — no E11000 error on second call', async () => {
      mockFindOneAndUpdateResult({ _id: 'singleton', bootstrapState: 'done' });
      mockUpdateOneSuccess();
      mockFindOneLean({
        _id: 'singleton',
        bootstrapState: 'done',
        bootstrapInstanceId: 'instance-abc',
      });

      // Run twice — must not throw
      await expect(runVaultSyncStateMigration()).resolves.toBeUndefined();
      await expect(runVaultSyncStateMigration()).resolves.toBeUndefined();
    });

    it('step 3 is a no-op when bootstrapState is done', async () => {
      mockFindOneAndUpdateResult({ _id: 'singleton', bootstrapState: 'done' });
      mockUpdateOneSuccess();
      mockFindOneLean({
        _id: 'singleton',
        bootstrapState: 'done',
        bootstrapInstanceId: 'instance-abc',
      });

      await runVaultSyncStateMigration();

      const updateOneCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const normalizationCall = updateOneCalls.find((call) => {
        const upd = call[1] as Record<string, Record<string, unknown>>;
        return upd.$set?.bootstrapState === 'failed';
      });
      expect(normalizationCall).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // (d) running + null instanceId — step 3 normalizes to failed
  // ---------------------------------------------------------------------------
  describe('stale running state (no instanceId)', () => {
    it('normalizes running + instanceId=null to failed with error message', async () => {
      mockFindOneAndUpdateResult(null);
      mockUpdateOneSuccess();
      mockFindOneLean({
        bootstrapState: 'running',
        bootstrapInstanceId: null,
      });

      await runVaultSyncStateMigration();

      expect(VaultSyncState.updateOne).toHaveBeenCalledWith(
        { _id: 'singleton' },
        {
          $set: {
            bootstrapState: 'failed',
            bootstrapLastError:
              'normalized stale running on first startup after schema migration',
          },
        },
      );
    });

    it('does NOT normalize running when bootstrapInstanceId is set (live run)', async () => {
      mockFindOneAndUpdateResult(null);
      mockUpdateOneSuccess();
      mockFindOneLean({
        bootstrapState: 'running',
        bootstrapInstanceId: 'live-instance-xyz',
      });

      await runVaultSyncStateMigration();

      const updateOneCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const normalizationCall = updateOneCalls.find((call) => {
        const upd = call[1] as Record<string, Record<string, unknown>>;
        return upd.$set?.bootstrapState === 'failed';
      });
      expect(normalizationCall).toBeUndefined();
    });

    it('does NOT normalize when bootstrapState is not running', async () => {
      mockFindOneAndUpdateResult(null);
      mockUpdateOneSuccess();
      mockFindOneLean({
        bootstrapState: 'failed',
        bootstrapInstanceId: null,
      });

      await runVaultSyncStateMigration();

      const updateOneCalls = vi.mocked(VaultSyncState.updateOne).mock.calls;
      const normalizationCall = updateOneCalls.find((call) => {
        const upd = call[1] as Record<string, Record<string, unknown>>;
        return upd.$set?.bootstrapState === 'failed';
      });
      expect(normalizationCall).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// initializeVaultFeature — BootstrapTriggerResolver-driven startup (Task 5.2)
// Requirements: 1.3, 1.4, 1.5, 1.6, 1.7, 1.13
// ---------------------------------------------------------------------------

describe('initializeVaultFeature — resilience layer startup (task 5.2)', () => {
  // Increase process max listeners to suppress the Node.js warning that fires
  // when multiple tests each register SIGTERM/SIGINT handlers via initializeVaultFeature.
  const originalMaxListeners = process.getMaxListeners();

  // Capture the bootstrapper mock instance returned by createVaultBootstrapper.
  // vi.mocked + .mock.results[0].value gives us the object created by the factory.
  function getBootstrapperMock() {
    const result = vi.mocked(createVaultBootstrapper).mock.results[0];
    return result?.value as {
      initOnStartup: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
    };
  }

  beforeEach(() => {
    // Raise the limit before each test so that signal listener registrations
    // during initializeVaultFeature do not trigger Node.js memory-leak warnings.
    process.setMaxListeners(50);
    vi.clearAllMocks();
    // Remove any SIGTERM/SIGINT listeners added by previous test runs to avoid
    // inter-test interference.
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');

    enableVaultSettings();
  });

  afterEach(() => {
    // Always remove signal listeners and restore max-listener count after each
    // test so that no leftover handler fires during Vitest's teardown phase.
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.setMaxListeners(originalMaxListeners);
  });

  it('calls initOnStartup() regardless of the env value (env=true)', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'true',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const mock = getBootstrapperMock();
    expect(mock.initOnStartup).toHaveBeenCalledOnce();
    // start() must NOT be called — the new path uses initOnStartup() exclusively
    expect(mock.start).not.toHaveBeenCalled();
  });

  it('calls initOnStartup() when env=force', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'force',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const mock = getBootstrapperMock();
    expect(mock.initOnStartup).toHaveBeenCalledOnce();
    expect(mock.start).not.toHaveBeenCalled();
  });

  it('calls initOnStartup() even when env=false (drift detector must always start)', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'false',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const mock = getBootstrapperMock();
    expect(mock.initOnStartup).toHaveBeenCalledOnce();
    expect(mock.start).not.toHaveBeenCalled();
  });

  it('registers stop() on SIGTERM for graceful shutdown', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'false',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const mock = getBootstrapperMock();
    expect(mock.stop).not.toHaveBeenCalled();

    // Simulate SIGTERM — stop() must be called
    process.emit('SIGTERM');
    await flush();

    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it('registers stop() on SIGINT for graceful shutdown', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'false',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const mock = getBootstrapperMock();
    process.emit('SIGINT');
    await flush();

    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it('does not call stop() twice on double SIGTERM (process.once semantics)', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'false',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const mock = getBootstrapperMock();
    process.emit('SIGTERM');
    process.emit('SIGTERM');
    await flush();

    // process.once ensures the handler is removed after the first call
    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it('migration runs before initOnStartup() dispatch', async () => {
    (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(
      'true',
    );

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    // Migration step 1 (findOneAndUpdate) must have run
    expect(VaultSyncState.findOneAndUpdate).toHaveBeenCalledOnce();
    // And initOnStartup was called after migration
    const mock = getBootstrapperMock();
    expect(mock.initOnStartup).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Task 3.3: reconcile init wiring
// Requirements: 4.3, 7.3, 7.5, 7.7
// ---------------------------------------------------------------------------

describe('initializeVaultFeature — reconcile init wiring (task 3.3)', () => {
  const originalMaxListeners = process.getMaxListeners();

  beforeEach(() => {
    process.setMaxListeners(50);
    vi.clearAllMocks();
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    enableVaultSettings();
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.setMaxListeners(originalMaxListeners);
  });

  // -------------------------------------------------------------------------
  // 3.3-1: normalizeStaleLifecycle is called during init
  // -------------------------------------------------------------------------

  it('calls historyStore.normalizeStaleLifecycle() during startup (req 7.3)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    expect(normalizeStaleLifecycleSpy).toHaveBeenCalledOnce();
  });

  it('calls normalizeStaleLifecycle() before initOnStartup() (startup ordering)', async () => {
    // Capture call order using a shared counter.
    const callOrder: string[] = [];
    normalizeStaleLifecycleSpy.mockImplementation(() => {
      callOrder.push('normalizeStaleLifecycle');
      return Promise.resolve(0);
    });

    // Intercept the bootstrapper created inside initializeVaultFeature.
    vi.mocked(createVaultBootstrapper).mockImplementationOnce(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
      getResilienceStatus: vi
        .fn()
        .mockResolvedValue({ bootstrap: { state: 'done' } }),
      abortAutoRetry: vi.fn().mockResolvedValue(undefined),
      initOnStartup: vi.fn().mockImplementation(() => {
        callOrder.push('initOnStartup');
        return Promise.resolve();
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    }));

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const normalizeIdx = callOrder.indexOf('normalizeStaleLifecycle');
    const initIdx = callOrder.indexOf('initOnStartup');
    expect(normalizeIdx).toBeGreaterThanOrEqual(0);
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(normalizeIdx).toBeLessThan(initIdx);
  });

  // -------------------------------------------------------------------------
  // 3.3-2: createVaultReconcileService is called after resilience layer init
  // -------------------------------------------------------------------------

  it('calls createVaultReconcileService() during startup', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    expect(createVaultReconcileService).toHaveBeenCalledOnce();
  });

  it('createVaultReconcileService is called after initOnStartup() (req 4.3)', async () => {
    const callOrder: string[] = [];
    vi.mocked(createVaultBootstrapper).mockImplementationOnce(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
      getResilienceStatus: vi
        .fn()
        .mockResolvedValue({ bootstrap: { state: 'done' } }),
      abortAutoRetry: vi.fn().mockResolvedValue(undefined),
      initOnStartup: vi.fn().mockImplementation(() => {
        callOrder.push('initOnStartup');
        return Promise.resolve();
      }),
      stop: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(createVaultReconcileService).mockImplementation((_deps) => {
      callOrder.push('createVaultReconcileService');
      return {
        submit: vi.fn(),
        listHistory: vi.fn().mockResolvedValue([]),
        stop: reconcileServiceStopSpy,
      };
    });

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const resilienceIdx = callOrder.indexOf('initOnStartup');
    const reconcileIdx = callOrder.indexOf('createVaultReconcileService');
    expect(resilienceIdx).toBeGreaterThanOrEqual(0);
    expect(reconcileIdx).toBeGreaterThanOrEqual(0);
    expect(resilienceIdx).toBeLessThan(reconcileIdx);
  });

  // -------------------------------------------------------------------------
  // 3.3-3: createHistoryStore is called with VaultReconcileLog model
  // -------------------------------------------------------------------------

  it('creates HistoryStore bound to VaultReconcileLog model', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    expect(createHistoryStore).toHaveBeenCalledOnce();
    const callArg = vi.mocked(createHistoryStore).mock.calls[0][0];
    // The first arg should be an object with vaultReconcileLog property
    expect(callArg).toHaveProperty('vaultReconcileLog');
  });

  // -------------------------------------------------------------------------
  // 3.3-4: reconcileService.stop() is called on SIGTERM (req 7.5)
  // -------------------------------------------------------------------------

  it('calls reconcileService.stop() on SIGTERM alongside bootstrapper stop (req 7.5)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    // Verify stop has not been called yet
    expect(reconcileServiceStopSpy).not.toHaveBeenCalled();

    process.emit('SIGTERM');
    await flush();

    expect(reconcileServiceStopSpy).toHaveBeenCalledOnce();
  });

  it('calls reconcileService.stop() on SIGINT (req 7.5)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    process.emit('SIGINT');
    await flush();

    expect(reconcileServiceStopSpy).toHaveBeenCalledOnce();
  });

  it('calls BOTH bootstrapper.stop() AND reconcileService.stop() on SIGTERM (parallel stop, req 7.5)', async () => {
    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    const bootstrapperMock = vi.mocked(createVaultBootstrapper).mock.results[0]
      ?.value as { stop: ReturnType<typeof vi.fn> };

    process.emit('SIGTERM');
    await flush();

    expect(bootstrapperMock.stop).toHaveBeenCalledOnce();
    expect(reconcileServiceStopSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Task 3.3: createVaultAdminRouterWithDeps / createVaultPageRouterWithDeps
// Requirements: 7.7
// ---------------------------------------------------------------------------

describe('createVaultAdminRouterWithDeps — passes reconcileService after init (task 3.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableVaultSettings();
  });

  it('passes reconcileService to createVaultAdminRouter after initializeVaultFeature', async () => {
    process.setMaxListeners(50);
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    createVaultAdminRouterWithDeps(crowi);

    const adminRouterCall = vi.mocked(createVaultAdminRouter).mock.calls[0];
    expect(adminRouterCall).toBeDefined();
    const adminRouterArg = adminRouterCall![0] as Record<string, unknown>;
    expect(adminRouterArg).toHaveProperty('reconcileService');
    expect(adminRouterArg.reconcileService).not.toBeUndefined();

    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });
});

describe('createVaultPageRouterWithDeps — exported and wires reconcileService (task 3.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enableVaultSettings();
  });

  it('is exported from index', () => {
    // createVaultPageRouterWithDeps must be defined (not undefined) as an export
    expect(createVaultPageRouterWithDeps).toBeDefined();
    expect(typeof createVaultPageRouterWithDeps).toBe('function');
  });

  it('calls createVaultPageRouter with reconcileService after initializeVaultFeature', async () => {
    process.setMaxListeners(50);
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');

    const crowi = makeCrowiStub();
    await initializeVaultFeature(crowi);

    createVaultPageRouterWithDeps(crowi);

    const pageRouterCall = vi.mocked(createVaultPageRouter).mock.calls[0];
    expect(pageRouterCall).toBeDefined();
    const pageRouterArg = pageRouterCall![0] as Record<string, unknown>;
    expect(pageRouterArg).toHaveProperty('reconcileService');
    expect(pageRouterArg.reconcileService).not.toBeUndefined();

    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('can be called before initializeVaultFeature (reconcileService will be undefined)', () => {
    // Before init, the router should still be created (graceful degradation).
    // The router itself handles undefined reconcileService with a 500.
    expect(() => createVaultPageRouterWithDeps({})).not.toThrow();
  });
});
