import type { IPage } from '@growi/core';
import { PageGrant, PageStatus } from '@growi/core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports so that vi.mock() hoisting works.
// ---------------------------------------------------------------------------

// Mock the VaultInstruction model so tests do not require a real MongoDB connection.
vi.mock('~/features/growi-vault/server/models/vault-instruction', () => ({
  VaultInstruction: {
    create: vi.fn(),
  },
}));

// Mock logger to suppress output and allow assertion if needed.
vi.mock('~/utils/logger', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Lazy imports after mocks are hoisted
// ---------------------------------------------------------------------------

const getVaultInstruction = async () =>
  (await import('~/features/growi-vault/server/models/vault-instruction'))
    .VaultInstruction;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal IPage stub for test cases. */
const buildPage = (
  overrides: Partial<IPage & { _id: { toString(): string } }> = {},
): IPage & { _id: { toString(): string } } => {
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
    ...overrides,
  } as unknown as IPage & { _id: { toString(): string } };
};

/** A lightweight VaultNamespaceMapper stub that returns predetermined namespaces. */
const buildMapper = (options: { current: string[]; previous?: string[] }) => ({
  computeAccessibleNamespaces: vi.fn(),
  computePageNamespaces: vi.fn().mockReturnValue({
    current: options.current,
    previous: options.previous,
  }),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VaultDispatcher', () => {
  let createSpy: MockInstance;

  beforeEach(async () => {
    vi.useFakeTimers();
    const VaultInstruction = await getVaultInstruction();
    createSpy = vi
      .mocked(VaultInstruction.create)
      .mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // create event → upsert
  // -------------------------------------------------------------------------

  describe('onPageChanged — create event', () => {
    it('enqueues an upsert instruction for each current namespace when create event fires (after coalesce window expires below threshold)', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: ['public'] });
      const dispatcher = createVaultDispatcher(mapper);

      const page = buildPage({ path: '/hello' });
      await dispatcher.onPageChanged({
        type: 'create',
        page,
        revisionId: 'rev-001',
      });

      // Advance the coalesce timer so the single entry is flushed as upsert.
      await vi.runAllTimersAsync();

      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'upsert',
          payload: expect.objectContaining({
            namespace: 'public',
            pageId: 'page-id-001',
            pagePath: '/hello',
            revisionId: 'rev-001',
          }),
        }),
      );
    });

    it('writes one upsert per current namespace when a page belongs to multiple namespaces', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: ['group-g1', 'group-g2'] });
      const dispatcher = createVaultDispatcher(mapper);

      const page = buildPage({ path: '/multi' });
      await dispatcher.onPageChanged({
        type: 'create',
        page,
        revisionId: 'rev-002',
      });
      await vi.runAllTimersAsync();

      // One upsert per namespace
      expect(createSpy).toHaveBeenCalledTimes(2);
      const calls = createSpy.mock.calls.map((c) => c[0].payload.namespace);
      expect(calls).toContain('group-g1');
      expect(calls).toContain('group-g2');
    });
  });

  // -------------------------------------------------------------------------
  // delete event → remove
  // -------------------------------------------------------------------------

  describe('onPageChanged — delete event', () => {
    it('emits a remove instruction immediately (no coalescing) for each current namespace', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: ['public'] });
      const dispatcher = createVaultDispatcher(mapper);

      const page = buildPage({ path: '/deleted-page' });
      await dispatcher.onPageChanged({ type: 'delete', page });

      // remove must be written synchronously, not waiting for a timer
      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'remove',
          payload: expect.objectContaining({
            namespace: 'public',
            pageId: 'page-id-001',
            pagePath: '/deleted-page',
          }),
        }),
      );
    });

    it('emits one remove per current namespace when the page belonged to multiple', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: ['group-a', 'group-b'] });
      const dispatcher = createVaultDispatcher(mapper);

      await dispatcher.onPageChanged({ type: 'delete', page: buildPage() });

      expect(createSpy).toHaveBeenCalledTimes(2);
      const ops = createSpy.mock.calls.map((c) => c[0].op);
      expect(ops).toEqual(['remove', 'remove']);
    });
  });

  // -------------------------------------------------------------------------
  // acl-change event → remove (previous) + upsert (current)
  // -------------------------------------------------------------------------

  describe('onPageChanged — acl-change event', () => {
    it('emits one remove per previous namespace and one upsert per current namespace', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: ['group-new'] });
      const dispatcher = createVaultDispatcher(mapper);

      const page = buildPage({ path: '/acl-page' });
      await dispatcher.onPageChanged({
        type: 'acl-change',
        page,
        revisionId: 'rev-acl',
        previousNamespaces: ['public'],
      });

      // 1 remove (public) + 1 upsert (group-new)
      expect(createSpy).toHaveBeenCalledTimes(2);

      const removeCall = createSpy.mock.calls.find((c) => c[0].op === 'remove');
      expect(removeCall?.[0].payload.namespace).toBe('public');

      const upsertCall = createSpy.mock.calls.find((c) => c[0].op === 'upsert');
      expect(upsertCall?.[0].payload.namespace).toBe('group-new');
      expect(upsertCall?.[0].payload.revisionId).toBe('rev-acl');
    });

    it('emits removes for all previous namespaces when there are multiple', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: ['public'] });
      const dispatcher = createVaultDispatcher(mapper);

      await dispatcher.onPageChanged({
        type: 'acl-change',
        page: buildPage(),
        previousNamespaces: ['group-old1', 'group-old2'],
      });

      const removes = createSpy.mock.calls.filter((c) => c[0].op === 'remove');
      expect(removes).toHaveLength(2);
      const removedNs = removes.map((c) => c[0].payload.namespace);
      expect(removedNs).toContain('group-old1');
      expect(removedNs).toContain('group-old2');
    });
  });

  // -------------------------------------------------------------------------
  // Coalesce: 100+ upserts in same namespace → bulk-upsert
  // -------------------------------------------------------------------------

  describe('coalesce — high-frequency upserts collapse into bulk-upsert', () => {
    it('emits a bulk-upsert when 100+ upsert events arrive within the coalesce window', async () => {
      const { createVaultDispatcher, COALESCE_THRESHOLD } = await import(
        './vault-dispatcher'
      );
      const mapper = buildMapper({ current: ['public'] });
      const dispatcher = createVaultDispatcher(mapper);

      // Enqueue COALESCE_THRESHOLD events for the same namespace.
      await Promise.all(
        Array.from({ length: COALESCE_THRESHOLD }, (_, i) => {
          const page = buildPage({
            _id: { toString: () => `page-${i}` },
            path: `/page/${i}`,
          });
          return dispatcher.onPageChanged({
            type: 'create',
            page,
            revisionId: `rev-${i}`,
          });
        }),
      );

      // Advance the timer to trigger the flush.
      await vi.runAllTimersAsync();

      // All writes should have been merged into bulk-upsert instruction(s).
      const calls = createSpy.mock.calls;
      const bulkCalls = calls.filter((c) => c[0].op === 'bulk-upsert');
      const upsertCalls = calls.filter((c) => c[0].op === 'upsert');

      expect(bulkCalls.length).toBeGreaterThan(0);
      expect(upsertCalls).toHaveLength(0);

      // Total entries across all bulk-upsert calls should equal COALESCE_THRESHOLD.
      const totalEntries = bulkCalls.reduce(
        (sum, c) => sum + (c[0].payload.entries?.length ?? 0),
        0,
      );
      expect(totalEntries).toBe(COALESCE_THRESHOLD);
    });
  });

  // -------------------------------------------------------------------------
  // Coalesce: events below threshold are individual upserts
  // -------------------------------------------------------------------------

  describe('coalesce — events below threshold are individual upserts', () => {
    it('emits individual upsert instructions when fewer than 100 events arrive within the window', async () => {
      const { createVaultDispatcher, COALESCE_THRESHOLD } = await import(
        './vault-dispatcher'
      );
      const mapper = buildMapper({ current: ['public'] });
      const dispatcher = createVaultDispatcher(mapper);

      const eventCount = COALESCE_THRESHOLD - 1; // 99 events
      await Promise.all(
        Array.from({ length: eventCount }, (_, i) => {
          const page = buildPage({
            _id: { toString: () => `page-${i}` },
            path: `/page/${i}`,
          });
          return dispatcher.onPageChanged({
            type: 'create',
            page,
            revisionId: `rev-${i}`,
          });
        }),
      );

      // Advance the timer.
      await vi.runAllTimersAsync();

      const calls = createSpy.mock.calls;
      const bulkCalls = calls.filter((c) => c[0].op === 'bulk-upsert');
      const upsertCalls = calls.filter((c) => c[0].op === 'upsert');

      expect(bulkCalls).toHaveLength(0);
      expect(upsertCalls).toHaveLength(eventCount);
    });
  });

  // -------------------------------------------------------------------------
  // Coalesce: events from distinct namespaces are not merged
  // -------------------------------------------------------------------------

  describe('coalesce — separate namespaces are not merged', () => {
    it('keeps events for different namespaces in separate coalesce buffers', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');

      // Mapper returns a different namespace per call based on the page path.
      let callCount = 0;
      const mapper = {
        computeAccessibleNamespaces: vi.fn(),
        computePageNamespaces: vi.fn().mockImplementation(() => {
          callCount++;
          return { current: [callCount % 2 === 0 ? 'group-a' : 'group-b'] };
        }),
      };
      const dispatcher = createVaultDispatcher(mapper);

      // 1 event for each namespace — both are below threshold individually.
      await dispatcher.onPageChanged({
        type: 'create',
        page: buildPage(),
        revisionId: 'r1',
      });
      await dispatcher.onPageChanged({
        type: 'create',
        page: buildPage(),
        revisionId: 'r2',
      });
      await vi.runAllTimersAsync();

      // Neither namespace reached the threshold, so upserts (not bulk-upsert) are expected.
      const bulkCalls = createSpy.mock.calls.filter(
        (c) => c[0].op === 'bulk-upsert',
      );
      expect(bulkCalls).toHaveLength(0);

      const upsertNamespaces = createSpy.mock.calls
        .filter((c) => c[0].op === 'upsert')
        .map((c) => c[0].payload.namespace);

      expect(upsertNamespaces).toContain('group-a');
      expect(upsertNamespaces).toContain('group-b');
    });
  });

  // -------------------------------------------------------------------------
  // onBulkOperation — rename-prefix
  // -------------------------------------------------------------------------

  describe('onBulkOperation — rename-prefix', () => {
    it('emits one rename-prefix instruction per affected namespace', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: [] });
      const dispatcher = createVaultDispatcher(mapper);

      await dispatcher.onBulkOperation({
        type: 'rename-prefix',
        namespaces: ['public', 'group-eng'],
        oldPrefix: '/old/parent',
        newPrefix: '/new/parent',
      });

      expect(createSpy).toHaveBeenCalledTimes(2);
      const ops = createSpy.mock.calls.map((c) => c[0].op);
      expect(ops).toEqual(['rename-prefix', 'rename-prefix']);

      const namespaces = createSpy.mock.calls.map(
        (c) => c[0].payload.namespace,
      );
      expect(namespaces).toContain('public');
      expect(namespaces).toContain('group-eng');

      // Each call should carry the correct prefix values.
      for (const call of createSpy.mock.calls) {
        expect(call[0].payload.oldPrefix).toBe('/old/parent');
        expect(call[0].payload.newPrefix).toBe('/new/parent');
      }
    });

    it('emits exactly one rename-prefix even when hundreds of descendants exist (namespace-level, not page-level)', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: [] });
      const dispatcher = createVaultDispatcher(mapper);

      // Only one namespace affected, regardless of descendant page count.
      await dispatcher.onBulkOperation({
        type: 'rename-prefix',
        namespaces: ['public'],
        oldPrefix: '/old',
        newPrefix: '/new',
      });

      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy.mock.calls[0][0].op).toBe('rename-prefix');
    });
  });

  // -------------------------------------------------------------------------
  // onBulkOperation — grant-change-prefix
  // -------------------------------------------------------------------------

  describe('onBulkOperation — grant-change-prefix', () => {
    it('emits one grant-change-prefix instruction per (fromNamespace, toNamespace) pair', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: [] });
      const dispatcher = createVaultDispatcher(mapper);

      await dispatcher.onBulkOperation({
        type: 'grant-change-prefix',
        namespaces: [],
        namespacePairs: [
          { fromNamespace: 'public', toNamespace: 'group-eng' },
          { fromNamespace: 'group-old', toNamespace: 'group-new' },
        ],
      });

      expect(createSpy).toHaveBeenCalledTimes(2);

      const payloads = createSpy.mock.calls.map((c) => c[0].payload);
      expect(payloads).toContainEqual(
        expect.objectContaining({
          fromNamespace: 'public',
          namespace: 'group-eng',
        }),
      );
      expect(payloads).toContainEqual(
        expect.objectContaining({
          fromNamespace: 'group-old',
          namespace: 'group-new',
        }),
      );
    });

    it('emits no instructions when namespacePairs is empty', async () => {
      const { createVaultDispatcher } = await import('./vault-dispatcher');
      const mapper = buildMapper({ current: [] });
      const dispatcher = createVaultDispatcher(mapper);

      await dispatcher.onBulkOperation({
        type: 'grant-change-prefix',
        namespaces: [],
        namespacePairs: [],
      });

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // coalesce window boundary: event arriving after window expires is a new window
  // -------------------------------------------------------------------------

  describe('coalesce window boundary', () => {
    it('events arriving after the coalesce window has flushed start a fresh window', async () => {
      const { createVaultDispatcher, COALESCE_WINDOW_MS } = await import(
        './vault-dispatcher'
      );
      const mapper = buildMapper({ current: ['public'] });
      const dispatcher = createVaultDispatcher(mapper);

      // Single event in the first window → individual upsert after timer fires.
      await dispatcher.onPageChanged({
        type: 'create',
        page: buildPage(),
        revisionId: 'r1',
      });
      await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

      // One individual upsert from the first window.
      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy.mock.calls[0][0].op).toBe('upsert');

      // Second event in a new window.
      createSpy.mockClear();
      await dispatcher.onPageChanged({
        type: 'create',
        page: buildPage(),
        revisionId: 'r2',
      });
      await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

      expect(createSpy).toHaveBeenCalledOnce();
      expect(createSpy.mock.calls[0][0].op).toBe('upsert');
    });
  });
});
