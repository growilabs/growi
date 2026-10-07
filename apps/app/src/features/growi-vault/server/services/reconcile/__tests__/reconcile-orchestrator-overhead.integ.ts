/**
 * reconcile-orchestrator-overhead.integ.ts
 *
 * Performance and idempotency integration tests for ReconcileOrchestrator.
 *
 * Tests:
 *   1. Accept gate — submit returns while the reconcile it scheduled is still in
 *      flight (see the test for why this is asserted relatively rather than as a
 *      wall-clock budget)
 *   2. Instruction count bounded — each page produces exactly 1 instruction when
 *      it has a unique namespace (the makeNamespaceMapper stub gives each page its
 *      own namespace, so no mid-stream chunk flush occurs; all buffers flush at
 *      end-of-stream → N instructions for N pages)
 *   3. Idempotency — vault_instructions are additive across runs (content-addressing
 *      dedup is the vault-manager's responsibility, not the orchestrator's)
 *   4. RSS test SKIPPED — unreliable in an in-memory MongoDB environment because
 *      the MongoMemoryReplSet process itself holds significant resident memory,
 *      and V8 GC is not deterministic enough to measure per-reconcile RSS deltas
 *      reliably in test isolation.
 *
 * Requirements: 4.1, 4.5, 6.10, 6.11, 7.1, 7.2
 */

import { EventEmitter } from 'node:events';
import mongoose from 'mongoose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { VaultInstruction } from '~/features/growi-vault/server/models/vault-instruction';
import { VaultReconcileLog } from '~/features/growi-vault/server/models/vault-reconcile-log';
import { createConcurrencyController } from '~/features/growi-vault/server/services/reconcile/reconcile-concurrency-controller';
import { createHistoryStore } from '~/features/growi-vault/server/services/reconcile/reconcile-history-store';
import { createReconcileOrchestrator } from '~/features/growi-vault/server/services/reconcile/reconcile-orchestrator';
import { createVaultReconcileService } from '~/features/growi-vault/server/services/reconcile/reconcile-service';
import { resolveTarget } from '~/features/growi-vault/server/services/reconcile/reconcile-target-resolver';
import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

// ---------------------------------------------------------------------------
// Minimal PageEvent EventEmitter
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

/** Each page maps to exactly one unique namespace based on its _id. */
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
        return opts.maxUser ?? 10000;
      if (key === 'app:vaultReconcileMaxPagesPerAdminRequest')
        return opts.maxAdmin ?? 10000;
      if (key === 'app:vaultReconcileRejectWhenBootstrapNotDone')
        return opts.rejectWhenBootstrapNotDone ?? false;
      return 0;
    },
    // biome-ignore lint/suspicious/noExplicitAny: test stub
  } as any;
}

function makeResilienceLayer(bootstrapState = 'done') {
  return { getStatus: async () => ({ bootstrap: { state: bootstrapState } }) };
}

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

const realTargetResolver = {
  resolveTarget: (
    targetType: Parameters<typeof resolveTarget>[0],
    targetPath: string,
  ) => resolveTarget(targetType, targetPath),
};

// ---------------------------------------------------------------------------
// Polling helper: callback-based to avoid await-in-loop lint warnings
// ---------------------------------------------------------------------------

function waitForReconcileStatus(
  reconcileId: string,
  expectedStatuses: string[],
  timeoutMs = 30000,
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

/**
 * Wait until no reconcile is still in flight.
 *
 * `afterEach` empties vault_instructions and vault_reconcile_log, but a reconcile
 * that is still running goes on writing into them afterwards, and that late row is
 * counted by the next test. The per-test `waitForReconcileStatus` calls do not
 * prevent this: they sit at the end of the test body, so any assertion that fails
 * before them skips the wait entirely. That is exactly how this file used to fail
 * in pairs — a failed assertion in the accept-gate test turned the following test's
 * "expected 25" into "expected 26". Draining here instead makes the cleanup
 * independent of whether the test passed.
 */
function waitForNoActiveReconciles(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      VaultReconcileLog.countDocuments({
        status: { $in: ['pending', 'running'] },
      })
        .then((count: number) => {
          if (count === 0) {
            resolve();
            return;
          }
          if (Date.now() >= deadline) {
            reject(
              new Error(
                `Timeout waiting for ${count} in-flight reconcile(s) to settle`,
              ),
            );
            return;
          }
          setTimeout(tick, 50);
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
  void VaultReconcileLog;
  void VaultInstruction;

  const s2sMessagingServiceMock = mock<S2sMessagingService>();
  configManager.setS2sMessagingService(s2sMessagingServiceMock);
  await configManager.loadConfigs();

  const pageModule = await import('~/server/models/page');
  Page = pageModule.default(makeCrowiMock());
});

afterEach(async () => {
  await waitForNoActiveReconciles();
  await mongoose.connection.collection('vault_reconcile_log').deleteMany({});
  await mongoose.connection.collection('vault_instructions').deleteMany({});
  await mongoose.connection.collection('pages').deleteMany({
    path: { $regex: '^/overhead-' },
  });
});

// ---------------------------------------------------------------------------
// Shared service factory
// ---------------------------------------------------------------------------

function buildService(opts: {
  chunkSize?: number;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  configManager?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  concurrencyController?: any;
  createActivity?: (data: { action: string }) => Promise<void>;
}) {
  const historyStore = createHistoryStore({
    vaultReconcileLog: VaultReconcileLog,
  });
  const concurrencyController =
    opts.concurrencyController ??
    createConcurrencyController({
      maxConcurrentPerUser: 10,
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
    chunkSize: opts.chunkSize ?? 10,
  });
  return createVaultReconcileService({
    pageModel: Page,
    targetResolver: realTargetResolver,
    aclEvaluator: makePassthroughAclEvaluator(),
    concurrencyController,
    historyStore,
    orchestrator,
    resilienceLayer: makeResilienceLayer('done'),
    configManager: opts.configManager ?? makeConfigManager(),
    createActivity: opts.createActivity as Parameters<
      typeof createVaultReconcileService
    >[0]['createActivity'],
  });
}

// ---------------------------------------------------------------------------
// Test 1: Accept gate does not block on the reconcile
// ---------------------------------------------------------------------------

describe('Accept gate', () => {
  /**
   * What is being guarded: the gate stays a cheap synchronous path (要件 6.2 —
   * one findOne, no collection scan) and hands the work to the background
   * orchestrator instead of awaiting it.
   *
   * Why this is asserted relatively — "submit returned before the reconcile it
   * scheduled finished" — rather than as a wall-clock budget: a slower machine
   * slows the gate and the reconcile by the same factor, so the property holds
   * regardless of how loaded the runner is. The absolute bound this replaced
   * (`elapsed < 200ms`) behaved the other way round on both counts. It failed on
   * CI runner noise alone (313ms observed on an otherwise healthy run), and it
   * could not have caught the regression it looked like it was guarding: measured
   * here, the gate takes ~8ms and the whole reconcile ~63ms, so a gate that
   * awaited the entire reconcile would still have come in under 200ms and passed.
   *
   * 要件 6.10's "accept gate p99 ≤ 200ms" is a production SLO. A single sample in
   * CI cannot measure a p99, so this test does not attempt to.
   */
  it('resolves while the reconcile it scheduled is still in flight', async () => {
    await Page.insertMany([
      {
        path: '/overhead-latency',
        descendantCount: 5,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
    ]);

    const service = buildService({});

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/overhead-latency',
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

    // Read the status the moment submit resolves: a gate that awaited the
    // orchestrator would already be at a terminal status here.
    const log = await VaultReconcileLog.findOne({ reconcileId }).lean();
    expect(['pending', 'running']).toContain(
      (log as Record<string, unknown> | null)?.status,
    );

    // The in-flight reconcile is drained by afterEach, which runs whether or not
    // the assertions above hold.
  });
});

// ---------------------------------------------------------------------------
// Test 2: Instruction count bounded
// ---------------------------------------------------------------------------

describe('Instruction count bounded', () => {
  it('vault_instructions count equals N when each page has a unique namespace', async () => {
    // With makeNamespaceMapper, each page has exactly 1 unique namespace.
    // Because each namespace is distinct, each buffer holds only 1 entry and
    // never triggers a mid-stream flush (chunkSize=10 is never reached).
    // All buffers flush at end-of-stream → 1 instruction per page = N total.
    const N = 25;

    await Page.insertMany([
      {
        path: '/overhead-count',
        descendantCount: N - 1,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      ...Array.from({ length: N - 1 }, (_, i) => ({
        path: `/overhead-count/c${i}`,
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      })),
    ]);

    const service = buildService({ chunkSize: 10 });

    const result = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/overhead-count',
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

    await waitForReconcileStatus(reconcileId, ['completed']);

    const instructionCount = await VaultInstruction.countDocuments({
      op: 'bulk-upsert',
    });
    expect(instructionCount).toBe(N);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Idempotency — instructions are additive (not deduplicated by orchestrator)
// ---------------------------------------------------------------------------

describe('Idempotency — orchestrator emits additive instructions', () => {
  it('running same sub-tree twice doubles the vault_instructions count', async () => {
    const N = 5;

    await Page.insertMany([
      {
        path: '/overhead-idempotent',
        descendantCount: N - 1,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      },
      ...Array.from({ length: N - 1 }, (_, i) => ({
        path: `/overhead-idempotent/c${i}`,
        descendantCount: 0,
        grant: 1,
        revision: new mongoose.Types.ObjectId(),
      })),
    ]);

    const service = buildService({ chunkSize: 10 });
    const userId = new mongoose.Types.ObjectId().toString();

    // First run
    const result1 = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/overhead-idempotent',
      triggeredBy: { userId, isAdmin: true },
    });
    expect(result1.status).toBe('accepted');
    await waitForReconcileStatus(
      (
        result1 as {
          status: 'accepted';
          reconcileId: string;
          descendantCount: number;
        }
      ).reconcileId,
      ['completed'],
    );

    const countAfterFirst = await VaultInstruction.countDocuments({
      op: 'bulk-upsert',
    });
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second run (same target, same eligibleQuery)
    const result2 = await service.submit({
      targetType: 'sub-tree',
      targetPath: '/overhead-idempotent',
      triggeredBy: { userId, isAdmin: true },
    });
    expect(result2.status).toBe('accepted');
    await waitForReconcileStatus(
      (
        result2 as {
          status: 'accepted';
          reconcileId: string;
          descendantCount: number;
        }
      ).reconcileId,
      ['completed'],
    );

    const countAfterSecond = await VaultInstruction.countDocuments({
      op: 'bulk-upsert',
    });

    // The orchestrator appends instructions without deduplication.
    // Dedup is vault-manager's responsibility (content-addressing).
    expect(countAfterSecond).toBe(countAfterFirst * 2);
  });
});
