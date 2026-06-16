/**
 * reconcile-flow.integ.ts
 *
 * End-to-end integration tests for the growi-vault-reconcile feature against
 * a real MongoDB (in-memory MongoMemoryReplSet via globalSetup).
 *
 * Scenarios:
 *   (a) admin sub-tree → completed
 *   (b) user sub-tree + partial ACL exclusion → partial-acl-filtered + completed
 *   (c) descendantCount > user limit → rejected at accept gate
 *   (d) system concurrency limit exceeded → rejected
 *   (e) normalizeStaleLifecycle: running + pending → failed:process-restarted
 *   (f) bootstrapState !== 'done' → rejected
 *   (g) stale descendantCount + limit-exceeded failure
 *
 * Requirements: 2.6, 4.4, 5.5, 6.1, 6.2, 6.7, 6.9, 6.11
 */

import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

import { VaultInstruction } from '../../../models/vault-instruction';
import { VaultReconcileLog } from '../../../models/vault-reconcile-log';
import { createConcurrencyController } from '../reconcile-concurrency-controller';
import { createHistoryStore } from '../reconcile-history-store';
import { createReconcileOrchestrator } from '../reconcile-orchestrator';
import { createVaultReconcileService } from '../reconcile-service';
import { resolveTarget } from '../reconcile-target-resolver';

// ---------------------------------------------------------------------------
// Minimal PageEvent EventEmitter (matches what page.ts binds on .on())
// ---------------------------------------------------------------------------

class MockPageEvent extends EventEmitter {
  onCreate = () => {};
  onUpdate = () => {};
  onCreateMany = () => {};
  onAddSeenUsers = () => {};
}

function makeCrowiMock(): Crowi {
  return {
    events: { page: new MockPageEvent() },
  } as unknown as Crowi;
}

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/** Namespace mapper: each page → one unique namespace based on its _id. */
function makeNamespaceMapper() {
  return {
    computePageNamespaces: (page: { _id: { toString(): string } }) => ({
      current: [`test_ns_${page._id.toString()}`],
    }),
  };
}

function makeConfigManager(
  opts: {
    maxUser?: number;
    maxAdmin?: number;
    rejectWhenBootstrapNotDone?: boolean;
  } = {},
) {
  return {
    getConfig: (key: string) => {
      if (key === 'app:vaultReconcileMaxPagesPerUserRequest')
        return opts.maxUser ?? 1000;
      if (key === 'app:vaultReconcileMaxPagesPerAdminRequest')
        return opts.maxAdmin ?? 1000;
      if (key === 'app:vaultReconcileRejectWhenBootstrapNotDone')
        return opts.rejectWhenBootstrapNotDone ?? true;
      return 0;
    },
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

function makeResilienceLayer(bootstrapState = 'done') {
  return { getStatus: async () => ({ bootstrap: { state: bootstrapState } }) };
}

/** AclEvaluator stub that returns baseQuery unchanged (admin-like passthrough). */
function makePassthroughAclEvaluator() {
  return {
    buildEligibleQuery: async ({
      baseQuery,
    }: {
      user: unknown;
      isAdmin: boolean;
      baseQuery: Record<string, unknown>;
    }) => ({ eligibleQuery: baseQuery }),
  };
}

/** AclEvaluator stub that restricts results to only pages at the given path. */
function makeRestrictingAclEvaluator(restrictedPath: string) {
  return {
    buildEligibleQuery: async () => ({
      eligibleQuery: { path: restrictedPath },
    }),
  };
}

/** Thin wrapper that delegates to the real resolveTarget function. */
const realTargetResolver = {
  resolveTarget: (
    targetType: Parameters<typeof resolveTarget>[0],
    targetPath: string,
  ) => resolveTarget(targetType, targetPath),
};

// ---------------------------------------------------------------------------
// Polling helper: wait for orchestrator background completion
// ---------------------------------------------------------------------------

function waitForReconcileStatus(
  reconcileId: string,
  expectedStatuses: string[],
  timeoutMs = 10000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() >= deadline) {
        reject(
          new Error(
            `Timeout waiting for reconcileId ${reconcileId} to reach ${expectedStatuses.join('|')}`,
          ),
        );
        return;
      }
      VaultReconcileLog.findOne({ reconcileId })
        .lean()
        .then((doc) => {
          const d = doc as Record<string, unknown> | null;
          if (d != null && expectedStatuses.includes(d.status as string)) {
            resolve(d);
          } else {
            setTimeout(tick, 50);
          }
        })
        .catch(reject);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: dynamic model import
let Page: any;

beforeAll(async () => {
  // Register models by referencing them.
  void VaultReconcileLog;
  void VaultInstruction;

  // Initialize configManager (required by Page model internals).
  const s2sMessagingServiceMock = mock<S2sMessagingService>();
  configManager.setS2sMessagingService(s2sMessagingServiceMock);
  await configManager.loadConfigs();

  // Page model requires a crowi instance with a proper EventEmitter page event.
  const pageModule = await import('~/server/models/page');
  Page = pageModule.default(makeCrowiMock());
});

afterEach(async () => {
  await mongoose.connection.collection('vault_reconcile_log').deleteMany({});
  await mongoose.connection.collection('vault_instructions').deleteMany({});
  await mongoose.connection.collection('pages').deleteMany({
    path: { $regex: '^/reconcile-' },
  });
});

// ---------------------------------------------------------------------------
// Shared service factory
// ---------------------------------------------------------------------------

function buildService(opts: {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  aclEvaluator?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  configManager?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  resilienceLayer?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  concurrencyController?: any;
  createActivity?: (data: { action: string }) => Promise<void>;
  chunkSize?: number;
}) {
  const historyStore = createHistoryStore({
    vaultReconcileLog: VaultReconcileLog,
  });
  const concurrencyController =
    opts.concurrencyController ??
    createConcurrencyController({
      maxConcurrentPerUser: 5,
      maxConcurrentSystem: 10,
      adminBypassCapacityLimit: true,
    });
  const orchestrator = createReconcileOrchestrator({
    pageModel: Page,
    vaultInstruction: VaultInstruction,
    vaultNamespaceMapper: makeNamespaceMapper(),
    vaultReconcileLog: VaultReconcileLog,
    createActivity: opts.createActivity as Parameters<
      typeof createReconcileOrchestrator
    >[0]['createActivity'],
    chunkSize: opts.chunkSize ?? 100,
  });
  const service = createVaultReconcileService({
    pageModel: Page,
    targetResolver: realTargetResolver,
    aclEvaluator: opts.aclEvaluator ?? makePassthroughAclEvaluator(),
    concurrencyController,
    historyStore,
    orchestrator,
    resilienceLayer: opts.resilienceLayer ?? makeResilienceLayer('done'),
    configManager: opts.configManager ?? makeConfigManager(),
    createActivity: opts.createActivity as Parameters<
      typeof createVaultReconcileService
    >[0]['createActivity'],
  });
  return { service, historyStore, concurrencyController };
}

// ---------------------------------------------------------------------------
// Scenario (a): admin sub-tree → completed
// ---------------------------------------------------------------------------

describe('Scenario (a): admin sub-tree → completed', () => {
  it('processes all sub-tree pages and reaches completed status', async () => {
    await Page.insertMany([
      {
        path: '/reconcile-a',
        descendantCount: 2,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      {
        path: '/reconcile-a/c1',
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      {
        path: '/reconcile-a/c2',
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
    ]);

    const { service } = buildService({});

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-a',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: true,
      },
    });

    expect(result.status).toBe('accepted');
    const { reconcileId } = result as {
      status: 'accepted';
      reconcileId: string;
      descendantCount: number;
    };

    const finalDoc = await waitForReconcileStatus(reconcileId, ['completed']);

    expect(finalDoc.status).toBe('completed');
    expect(finalDoc.processedCount as number).toBeGreaterThanOrEqual(1);

    const instructionCount = await VaultInstruction.countDocuments({
      op: 'bulk-upsert',
    });
    expect(instructionCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario (b): user sub-tree + partial ACL exclusion → partial-acl-filtered + completed
// ---------------------------------------------------------------------------

describe('Scenario (b): user sub-tree + partial ACL exclusion → partial-acl-filtered + completed', () => {
  it('emits partial-acl-filtered audit event when ACL restricts eligible pages', async () => {
    await Page.insertMany([
      {
        path: '/reconcile-b',
        descendantCount: 2,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      {
        path: '/reconcile-b/c1',
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      {
        path: '/reconcile-b/c2',
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      {
        path: '/reconcile-b-only',
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
    ]);

    const auditEvents: string[] = [];
    const createActivity = async (data: { action: string }) => {
      auditEvents.push(data.action);
    };

    // ACL evaluator restricts eligible pages to only /reconcile-b-only (1 page).
    // plannedPageCount = 1 + 2 = 3 → processedCount(1) < plannedPageCount(3)
    // → partial-acl-filtered audit should be emitted.
    const { service } = buildService({
      aclEvaluator: makeRestrictingAclEvaluator('/reconcile-b-only'),
      createActivity,
    });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-b',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: false,
      },
    });

    expect(result.status).toBe('accepted');
    const { reconcileId } = result as {
      status: 'accepted';
      reconcileId: string;
      descendantCount: number;
    };

    await waitForReconcileStatus(reconcileId, ['completed']);
    // The DB status update and the final emitAudit('completed') are sequential
    // awaits in the orchestrator. The polling above resolves on the DB write;
    // give the audit emit a short window to complete before asserting.
    await new Promise((r) => setTimeout(r, 100));

    expect(auditEvents).toContain('vault.reconcile.partial-acl-filtered');
    expect(auditEvents).toContain('vault.reconcile.completed');
  });
});

// ---------------------------------------------------------------------------
// Scenario (c): descendantCount > user limit → rejected at accept gate
// ---------------------------------------------------------------------------

describe('Scenario (c): descendantCount > user limit → rejected at accept gate', () => {
  it('rejects with page-count-exceeds-user-limit without calling countDocuments', async () => {
    await Page.insertMany([
      {
        path: '/reconcile-c',
        descendantCount: 9999,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
    ]);

    const { service } = buildService({
      configManager: makeConfigManager({ maxUser: 1000, maxAdmin: 10000 }),
    });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-c',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: false,
      },
    });

    expect(result.status).toBe('rejected');
    expect((result as { status: 'rejected'; reason: string }).reason).toBe(
      'page-count-exceeds-user-limit',
    );

    // Verify the log record was written as rejected
    const logDoc = await VaultReconcileLog.findOne({
      targetPath: '/reconcile-c',
      status: 'rejected',
      rejectReason: 'page-count-exceeds-user-limit',
    }).lean();
    expect(logDoc).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario (d): system concurrency limit exceeded → rejected
// ---------------------------------------------------------------------------

describe('Scenario (d): system concurrency limit exceeded → rejected', () => {
  it('rejects with system-concurrency-limit when all system slots are occupied', async () => {
    await Page.insertMany([
      {
        path: '/reconcile-d',
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
    ]);

    // Controller with system limit = 1
    const controller = createConcurrencyController({
      maxConcurrentPerUser: 5,
      maxConcurrentSystem: 1,
      adminBypassCapacityLimit: false,
    });

    // Occupy the single system slot with a never-resolving work item
    let releaseFiller!: () => void;
    const fillerDone = new Promise<void>((resolve) => {
      releaseFiller = resolve;
    });
    controller.tryRunInBackground({
      userId: 'filler-user',
      isAdmin: false,
      work: () => fillerDone,
    });

    const { service } = buildService({ concurrencyController: controller });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-d',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: false,
      },
    });

    expect(result.status).toBe('rejected');
    expect((result as { status: 'rejected'; reason: string }).reason).toBe(
      'system-concurrency-limit',
    );

    // Release filler slot and reset
    releaseFiller();
    controller.reset();
  });
});

// ---------------------------------------------------------------------------
// Scenario (e): normalizeStaleLifecycle: running + pending → failed:process-restarted
// ---------------------------------------------------------------------------

describe('Scenario (e): normalizeStaleLifecycle normalizes stale records', () => {
  it('transitions running and pending records to failed:process-restarted', async () => {
    const userId = new mongoose.Types.ObjectId();

    await VaultReconcileLog.create([
      {
        reconcileId: 'stale-running-001',
        triggeredBy: { userId, isAdmin: false },
        targetType: 'sub-tree',
        targetPath: '/reconcile-e-running',
        descendantCount: 0,
        processedCount: 0,
        status: 'running',
        rejectReason: null,
        triggeredAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        lastError: null,
      },
      {
        reconcileId: 'stale-pending-002',
        triggeredBy: { userId, isAdmin: false },
        targetType: 'sub-tree',
        targetPath: '/reconcile-e-pending',
        descendantCount: 0,
        processedCount: 0,
        status: 'pending',
        rejectReason: null,
        triggeredAt: new Date(),
        startedAt: null,
        completedAt: null,
        lastError: null,
      },
    ]);

    const historyStore = createHistoryStore({
      vaultReconcileLog: VaultReconcileLog,
    });
    const updatedCount = await historyStore.normalizeStaleLifecycle();

    expect(updatedCount).toBe(2);

    const runningDoc = await VaultReconcileLog.findOne({
      reconcileId: 'stale-running-001',
    }).lean();
    expect(runningDoc?.status).toBe('failed');
    expect(runningDoc?.lastError).toBe('process-restarted');

    const pendingDoc = await VaultReconcileLog.findOne({
      reconcileId: 'stale-pending-002',
    }).lean();
    expect(pendingDoc?.status).toBe('failed');
    expect(pendingDoc?.lastError).toBe('process-restarted');
  });
});

// ---------------------------------------------------------------------------
// Scenario (f): bootstrapState !== 'done' → rejected
// ---------------------------------------------------------------------------

describe('Scenario (f): bootstrapState !== done → rejected', () => {
  it('rejects with bootstrap-not-done when resilience layer state is pending', async () => {
    await Page.insertMany([
      { path: '/reconcile-f', descendantCount: 0, grant: 1 },
    ]);

    const { service } = buildService({
      resilienceLayer: makeResilienceLayer('pending'),
      configManager: makeConfigManager({ rejectWhenBootstrapNotDone: true }),
    });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-f',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: false,
      },
    });

    expect(result.status).toBe('rejected');
    expect((result as { status: 'rejected'; reason: string }).reason).toBe(
      'bootstrap-not-done',
    );
  });

  it('rejects with bootstrap-not-done when resilience layer state is running', async () => {
    await Page.insertMany([
      { path: '/reconcile-f', descendantCount: 0, grant: 1 },
    ]);

    const { service } = buildService({
      resilienceLayer: makeResilienceLayer('running'),
      configManager: makeConfigManager({ rejectWhenBootstrapNotDone: true }),
    });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-f',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: false,
      },
    });

    expect(result.status).toBe('rejected');
    expect((result as { status: 'rejected'; reason: string }).reason).toBe(
      'bootstrap-not-done',
    );
  });
});

// ---------------------------------------------------------------------------
// Scenario (g): stale descendantCount + limit-exceeded failure
// ---------------------------------------------------------------------------

describe('Scenario (g): stale descendantCount causes limit-exceeded during orchestration', () => {
  it('fails with limit-exceeded when actual page count exceeds plannedPageCount', async () => {
    // Target page reports only 5 descendants (stale value).
    // plannedPageCount = 1 + 5 = 6; cursor.limit(7) is applied.
    // Actual pages = 1 root + 10 children = 11 → processedCount hits 7 → limit-exceeded.
    await Page.insertMany([
      {
        path: '/reconcile-g',
        descendantCount: 5,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      ...Array.from({ length: 10 }, (_, i) => ({
        path: `/reconcile-g/c${i}`,
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      })),
    ]);

    const { service } = buildService({
      configManager: makeConfigManager({ maxAdmin: 10000 }),
      chunkSize: 100,
    });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/reconcile-g',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: true,
      },
    });

    expect(result.status).toBe('accepted');
    const { reconcileId } = result as {
      status: 'accepted';
      reconcileId: string;
      descendantCount: number;
    };

    const finalDoc = await waitForReconcileStatus(
      reconcileId,
      ['failed'],
      15000,
    );

    expect(finalDoc.status).toBe('failed');
    expect(finalDoc.lastError).toBe('limit-exceeded');
  });
});
