import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the SUT import.
// ---------------------------------------------------------------------------

vi.mock('./services/vault-settings-service', () => ({
  vaultSettingsService: {
    getSettings: vi.fn(),
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
// Import the SUT after the mocks are in place.
// ---------------------------------------------------------------------------

import { configManager } from '~/server/service/config-manager';

import { initializeVaultFeature } from './index';
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

function enableVaultSettings() {
  (
    vaultSettingsService.getSettings as ReturnType<typeof vi.fn>
  ).mockResolvedValue({
    enabled: true,
    managerEndpoint: 'http://vault-manager',
    managerInternalSecret: 'secret',
  });
  (configManager.getConfig as ReturnType<typeof vi.fn>).mockReturnValue(false);
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
