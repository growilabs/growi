/**
 * reconcile-orchestrator.spec.ts
 *
 * Unit tests for ReconcileOrchestrator — async cursor stream + namespace
 * calculation + bulk-upsert instruction emission worker.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.4, 5.5, 6.10, 6.11
 * Design: Components and Interfaces > ReconcileOrchestrator
 *
 * All external dependencies are mocked. No real MongoDB connection is required.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReconcileOrchestrator } from '../reconcile-orchestrator';
import { createReconcileOrchestrator } from '../reconcile-orchestrator';

// ---------------------------------------------------------------------------
// Cursor mock helper
// ---------------------------------------------------------------------------

/**
 * Creates a mock async iterable cursor that yields the given pages in order.
 * The cursor also exposes a `close()` method so the orchestrator can close it
 * early on limit-exceeded.
 */
function makeCursor(pages: Record<string, unknown>[]) {
  let i = 0;
  let closed = false;

  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (closed || i >= pages.length) {
            return Promise.resolve({ done: true as const, value: undefined });
          }
          return Promise.resolve({ done: false as const, value: pages[i++] });
        },
      };
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
    get isClosed() {
      return closed;
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency builder
// ---------------------------------------------------------------------------

type MockPage = {
  _id: string;
  path: string;
  revision: string;
};

function buildMockPage(id: string, path: string): MockPage {
  return { _id: id, path, revision: `rev-${id}` };
}

function buildDeps(
  pages: Record<string, unknown>[],
  opts?: { chunkSize?: number },
) {
  const cursor = makeCursor(pages);

  const cursorFn = vi.fn().mockReturnValue(cursor);
  const leanFn = vi.fn().mockReturnValue({ cursor: cursorFn });
  const limitFn = vi.fn().mockReturnValue({ lean: leanFn });
  const findFn = vi.fn().mockReturnValue({ limit: limitFn });

  const pageModel = { find: findFn };

  const vaultInstruction = {
    create: vi.fn().mockResolvedValue({ _id: 'instr-id-1' }),
  };

  const vaultNamespaceMapper = {
    computePageNamespaces: vi.fn().mockReturnValue({ current: ['public'] }),
  };

  const vaultReconcileLog = {
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };

  const createActivity = vi.fn().mockResolvedValue(undefined);

  const chunkSize = opts?.chunkSize ?? 10;

  return {
    cursor,
    pageModel,
    vaultInstruction,
    vaultNamespaceMapper,
    vaultReconcileLog,
    createActivity,
    chunkSize,
    findFn,
    limitFn,
    leanFn,
    cursorFn,
  };
}

// ---------------------------------------------------------------------------
// Shared run opts
// ---------------------------------------------------------------------------

const BASE_OPTS = {
  reconcileId: 'recon-001',
  eligibleQuery: { path: '/test' },
  plannedPageCount: 5,
  triggeredBy: { userId: 'user-1', isAdmin: true },
  targetType: 'page' as const,
  targetPath: '/test',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReconcileOrchestrator', () => {
  // -------------------------------------------------------------------------
  // 1. Happy path: N pages (N < plannedPageCount)
  // -------------------------------------------------------------------------
  describe('happy path (N pages, N < plannedPageCount)', () => {
    let deps: ReturnType<typeof buildDeps>;
    let orchestrator: ReconcileOrchestrator;
    const pages = [
      buildMockPage('p1', '/page-1'),
      buildMockPage('p2', '/page-2'),
      buildMockPage('p3', '/page-3'),
    ];

    beforeEach(async () => {
      deps = buildDeps(pages, { chunkSize: 10 });
      orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });
      await orchestrator.run({ ...BASE_OPTS, plannedPageCount: 5 });
    });

    it('updates status to running at start', () => {
      const calls = (
        deps.vaultReconcileLog.updateOne as ReturnType<typeof vi.fn>
      ).mock.calls;
      const firstCall = calls[0];
      expect(firstCall[0]).toEqual({ reconcileId: 'recon-001' });
      expect(firstCall[1].$set).toMatchObject({ status: 'running' });
      expect(firstCall[1].$set.startedAt).toBeInstanceOf(Date);
    });

    it('emits vault.reconcile.started audit', () => {
      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      expect(auditCalls[0][0].action).toBe('vault.reconcile.started');
    });

    it('calls find with eligibleQuery and limit(plannedPageCount + 1)', () => {
      expect(deps.findFn).toHaveBeenCalledWith({ path: '/test' });
      expect(deps.limitFn).toHaveBeenCalledWith(6); // plannedPageCount + 1
    });

    it('calls computePageNamespaces for each page', () => {
      expect(
        deps.vaultNamespaceMapper.computePageNamespaces,
      ).toHaveBeenCalledTimes(3);
    });

    it('creates bulk-upsert instructions at end of stream', () => {
      expect(deps.vaultInstruction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'bulk-upsert',
          payload: expect.objectContaining({
            namespace: 'public',
            entries: expect.arrayContaining([
              expect.objectContaining({
                pageId: 'p1',
                pagePath: '/page-1',
                revisionId: 'rev-p1',
              }),
            ]),
          }),
        }),
      );
    });

    it('updates status to completed with correct processedCount', () => {
      const calls = (
        deps.vaultReconcileLog.updateOne as ReturnType<typeof vi.fn>
      ).mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[1].$set).toMatchObject({
        status: 'completed',
        processedCount: 3,
      });
      expect(lastCall[1].$set.completedAt).toBeInstanceOf(Date);
    });

    it('emits vault.reconcile.completed audit', () => {
      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      const completedCall = auditCalls.find(
        (c: [{ action: string }]) =>
          c[0].action === 'vault.reconcile.completed',
      );
      expect(completedCall).toBeDefined();
    });

    it('does NOT emit partial-acl-filtered for admin', () => {
      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      const filteredCall = auditCalls.find(
        (c: [{ action: string }]) =>
          c[0].action === 'vault.reconcile.partial-acl-filtered',
      );
      expect(filteredCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. limit-exceeded: processedCount reaches plannedPageCount + 1
  // -------------------------------------------------------------------------
  describe('limit-exceeded: more pages than plannedPageCount', () => {
    let deps: ReturnType<typeof buildDeps>;
    const pages = [
      buildMockPage('p1', '/page-1'),
      buildMockPage('p2', '/page-2'),
      buildMockPage('p3', '/page-3'),
      buildMockPage('p4', '/page-4'), // plannedPageCount + 1 (the limit-exceeded trigger)
    ];

    beforeEach(async () => {
      deps = buildDeps(pages, { chunkSize: 10 });
      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });
      await orchestrator.run({ ...BASE_OPTS, plannedPageCount: 3 }); // cap at 3
    });

    it('updates status to failed with lastError limit-exceeded', () => {
      const calls = (
        deps.vaultReconcileLog.updateOne as ReturnType<typeof vi.fn>
      ).mock.calls;
      const failedCall = calls.find(
        (c: [unknown, { $set: { status?: string } }]) =>
          c[1].$set?.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: defined by expect above
      expect(failedCall![1].$set).toMatchObject({
        status: 'failed',
        lastError: 'limit-exceeded',
      });
      // biome-ignore lint/style/noNonNullAssertion: defined by expect above
      expect(failedCall![1].$set.completedAt).toBeInstanceOf(Date);
    });

    it('emits vault.reconcile.failed audit', () => {
      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      const failedCall = auditCalls.find(
        (c: [{ action: string }]) => c[0].action === 'vault.reconcile.failed',
      );
      expect(failedCall).toBeDefined();
    });

    it('does NOT update status to completed', () => {
      const calls = (
        deps.vaultReconcileLog.updateOne as ReturnType<typeof vi.fn>
      ).mock.calls;
      const completedCall = calls.find(
        (c: [unknown, { $set: { status?: string } }]) =>
          c[1].$set?.status === 'completed',
      );
      expect(completedCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. partial-acl-filtered: non-admin, processedCount < plannedPageCount
  // -------------------------------------------------------------------------
  describe('partial-acl-filtered audit for non-admin user', () => {
    it('emits partial-acl-filtered when non-admin and processedCount < plannedPageCount', async () => {
      const pages = [
        buildMockPage('p1', '/page-1'),
        buildMockPage('p2', '/page-2'),
      ];
      const deps = buildDeps(pages, { chunkSize: 10 });
      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({
        ...BASE_OPTS,
        plannedPageCount: 10, // processed (2) < plannedPageCount (10)
        triggeredBy: { userId: 'user-1', isAdmin: false }, // non-admin
      });

      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      const filteredCall = auditCalls.find(
        (c: [{ action: string }]) =>
          c[0].action === 'vault.reconcile.partial-acl-filtered',
      );
      expect(filteredCall).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: defined by expect above
      expect(filteredCall![0]).toMatchObject({
        action: 'vault.reconcile.partial-acl-filtered',
        data: expect.objectContaining({
          reconcileId: 'recon-001',
          plannedPageCount: 10,
          processedCount: 2,
        }),
      });
    });

    it('does NOT emit partial-acl-filtered when admin, even if processedCount < plannedPageCount', async () => {
      const pages = [buildMockPage('p1', '/page-1')];
      const deps = buildDeps(pages, { chunkSize: 10 });
      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({
        ...BASE_OPTS,
        plannedPageCount: 10, // processed (1) < plannedPageCount (10)
        triggeredBy: { userId: 'user-1', isAdmin: true },
      });

      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      const filteredCall = auditCalls.find(
        (c: [{ action: string }]) =>
          c[0].action === 'vault.reconcile.partial-acl-filtered',
      );
      expect(filteredCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Exception during stream → status=failed, lastError=error.message
  // -------------------------------------------------------------------------
  describe('exception during stream processing', () => {
    it('records status failed with the error message and emits audit failed', async () => {
      const brokenCursor = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(new Error('stream-exploded'));
            },
          };
        },
        close() {
          return Promise.resolve();
        },
      };

      const deps = buildDeps([], { chunkSize: 10 });
      // Override the cursor mock to throw
      (deps.cursorFn as ReturnType<typeof vi.fn>).mockReturnValue(brokenCursor);

      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({ ...BASE_OPTS });

      const updateCalls = (
        deps.vaultReconcileLog.updateOne as ReturnType<typeof vi.fn>
      ).mock.calls;
      const failedCall = updateCalls.find(
        (c: [unknown, { $set: { status?: string } }]) =>
          c[1].$set?.status === 'failed',
      );
      expect(failedCall).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: defined by expect above
      expect(failedCall![1].$set.lastError).toBe('stream-exploded');

      const auditCalls = (deps.createActivity as ReturnType<typeof vi.fn>).mock
        .calls;
      const auditFailed = auditCalls.find(
        (c: [{ action: string }]) => c[0].action === 'vault.reconcile.failed',
      );
      expect(auditFailed).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Page with empty namespace array → counted but no bulk-upsert
  // -------------------------------------------------------------------------
  describe('page with empty namespace array', () => {
    it('counts the page but does not create bulk-upsert instructions', async () => {
      const pages = [buildMockPage('p1', '/page-1')];
      const deps = buildDeps(pages, { chunkSize: 10 });

      // Return empty namespaces for this page
      (
        deps.vaultNamespaceMapper.computePageNamespaces as ReturnType<
          typeof vi.fn
        >
      ).mockReturnValue({ current: [] });

      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({ ...BASE_OPTS, plannedPageCount: 5 });

      expect(deps.vaultInstruction.create).not.toHaveBeenCalled();

      const calls = (
        deps.vaultReconcileLog.updateOne as ReturnType<typeof vi.fn>
      ).mock.calls;
      const completedCall = calls.find(
        (c: [unknown, { $set: { status?: string } }]) =>
          c[1].$set?.status === 'completed',
      );
      expect(completedCall).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: defined by expect above
      expect(completedCall![1].$set.processedCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Chunk flush: buffer reaches chunkSize → intermediate flush
  // -------------------------------------------------------------------------
  describe('chunk flush on buffer full', () => {
    it('flushes buffer when it reaches chunkSize and produces multiple instructions', async () => {
      const pages = [
        buildMockPage('p1', '/page-1'),
        buildMockPage('p2', '/page-2'),
        buildMockPage('p3', '/page-3'),
      ];
      const deps = buildDeps(pages, { chunkSize: 2 }); // chunkSize=2

      // All pages go to 'public' namespace
      (
        deps.vaultNamespaceMapper.computePageNamespaces as ReturnType<
          typeof vi.fn
        >
      ).mockReturnValue({ current: ['public'] });

      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({ ...BASE_OPTS, plannedPageCount: 10 });

      // chunkSize=2: after 2 pages → flush (instruction 1), after stream end → flush remaining 1 page (instruction 2)
      const createCalls = (
        deps.vaultInstruction.create as ReturnType<typeof vi.fn>
      ).mock.calls;
      expect(createCalls.length).toBe(2);

      // First flush: 2 entries (pages p1, p2)
      expect(createCalls[0][0].payload.entries).toHaveLength(2);
      // Second flush: 1 remaining entry (page p3)
      expect(createCalls[1][0].payload.entries).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Remaining buffer flush at end of stream
  // -------------------------------------------------------------------------
  describe('remaining buffer flushed at end of stream', () => {
    it('flushes remaining buffer entries after stream ends', async () => {
      const pages = [
        buildMockPage('p1', '/page-1'),
        buildMockPage('p2', '/page-2'),
      ];
      const deps = buildDeps(pages, { chunkSize: 100 }); // large chunkSize so no intermediate flush

      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({ ...BASE_OPTS, plannedPageCount: 10 });

      const createCalls = (
        deps.vaultInstruction.create as ReturnType<typeof vi.fn>
      ).mock.calls;
      // Both pages in a single end-of-stream flush
      expect(createCalls).toHaveLength(1);
      expect(createCalls[0][0].payload.entries).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Multiple namespaces per page → separate buffers
  // -------------------------------------------------------------------------
  describe('page with multiple namespaces', () => {
    it('pushes entries to separate namespace buffers', async () => {
      const pages = [buildMockPage('p1', '/page-1')];
      const deps = buildDeps(pages, { chunkSize: 10 });

      (
        deps.vaultNamespaceMapper.computePageNamespaces as ReturnType<
          typeof vi.fn
        >
      ).mockReturnValue({
        current: ['public', 'group-abc'],
      });

      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: deps.createActivity,
        chunkSize: deps.chunkSize,
      });

      await orchestrator.run({ ...BASE_OPTS, plannedPageCount: 5 });

      const createCalls = (
        deps.vaultInstruction.create as ReturnType<typeof vi.fn>
      ).mock.calls;
      // One flush per namespace
      expect(createCalls).toHaveLength(2);
      const namespaces = createCalls.map(
        (c: [{ payload: { namespace: string } }]) => c[0].payload.namespace,
      );
      expect(namespaces).toContain('public');
      expect(namespaces).toContain('group-abc');
    });
  });

  // -------------------------------------------------------------------------
  // 9. createActivity is optional (undefined)
  // -------------------------------------------------------------------------
  describe('createActivity is optional', () => {
    it('does not throw when createActivity is undefined', async () => {
      const pages = [buildMockPage('p1', '/page-1')];
      const deps = buildDeps(pages, { chunkSize: 10 });

      const orchestrator = createReconcileOrchestrator({
        pageModel: deps.pageModel as never,
        vaultInstruction: deps.vaultInstruction as never,
        vaultNamespaceMapper: deps.vaultNamespaceMapper as never,
        vaultReconcileLog: deps.vaultReconcileLog as never,
        createActivity: undefined,
        chunkSize: deps.chunkSize,
      });

      await expect(orchestrator.run({ ...BASE_OPTS })).resolves.not.toThrow();
    });
  });
});
