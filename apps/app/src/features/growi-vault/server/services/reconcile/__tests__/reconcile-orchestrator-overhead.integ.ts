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
import type { ReconcileOrchestrator } from '~/features/growi-vault/server/services/reconcile/reconcile-orchestrator';
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

/** The real orchestrator, wired the same way `buildService` wires it by default. */
function buildOrchestrator(opts: {
  chunkSize?: number;
  createActivity?: (data: { action: string }) => Promise<void>;
}): ReconcileOrchestrator {
  return createReconcileOrchestrator({
    pageModel: Page,
    vaultInstruction: VaultInstruction,
    vaultNamespaceMapper: makeNamespaceMapper(),
    vaultReconcileLog: VaultReconcileLog,
    createActivity: opts.createActivity as Parameters<
      typeof createReconcileOrchestrator
    >[0]['createActivity'],
    chunkSize: opts.chunkSize ?? 10,
  });
}

/**
 * Wraps a real orchestrator so `run()` blocks on a gate the caller controls,
 * instead of running to completion immediately. Lets a test hold a reconcile
 * "in flight" deterministically and release it explicitly — see the Accept
 * gate test below for why this replaced asserting on real timing.
 */
function makeBlockableOrchestrator(real: ReconcileOrchestrator): {
  orchestrator: ReconcileOrchestrator;
  release: () => void;
} {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    orchestrator: {
      run: async (runOpts) => {
        await gate;
        await real.run(runOpts);
      },
    },
    release,
  };
}

function buildService(opts: {
  chunkSize?: number;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  configManager?: any;
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  concurrencyController?: any;
  orchestrator?: ReconcileOrchestrator;
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
  const orchestrator = opts.orchestrator ?? buildOrchestrator(opts);
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
   * This used to assert the property relatively ("submit returned before the
   * reconcile it scheduled finished") rather than as a wall-clock budget, but
   * relative timing is still a race: under a fast/warm-connection interleaving
   * the background reconcile can finish before the test's own follow-up query
   * runs, making the assertion flaky in either direction regardless of which
   * side it compares (see #11802/#11960).
   *
   * Instead, `makeBlockableOrchestrator` wraps the real orchestrator behind a
   * gate the test controls, so `orchestrator.run()` cannot proceed past its
   * first line until `release()` is called. This makes the property
   * deterministic rather than a race: `submit()` resolving at all — before
   * `release()` is ever called — is only possible if it did not await
   * `orchestrator.run()` to completion. If `submit()` regressed to awaiting it
   * directly (bypassing the concurrency controller's background dispatch),
   * `submitPromise` would hang until the gate is released, which never happens
   * before the guard below fires.
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

    const { orchestrator, release } = makeBlockableOrchestrator(
      buildOrchestrator({}),
    );
    const service = buildService({ orchestrator });

    const submitPromise = service.submit({
      targetType: 'sub-tree',
      targetPath: '/overhead-latency',
      triggeredBy: {
        userId: new mongoose.Types.ObjectId().toString(),
        isAdmin: true,
      },
    });

    // Guard against a hang: if submit() awaited the gated orchestrator.run(),
    // submitPromise never settles on its own (release() is only called below,
    // after this has already been awaited). A clear failure beats a silent
    // timeout at the suite's own default.
    const result = (await Promise.race([
      submitPromise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              'submit() did not resolve while orchestrator.run() was gated — ' +
                'the accept gate appears to be awaiting the background reconcile',
            ),
          );
        }, 5000);
      }),
    ])) as Awaited<typeof submitPromise>;

    expect(result.status).toBe('accepted');
    const { reconcileId } = result as {
      status: 'accepted';
      reconcileId: string;
      descendantCount: number;
    };

    // Deterministic, not a timing race: orchestrator.run() is still held at
    // the gate, so nothing has had a chance to move the log past the status
    // submit() itself wrote before ever scheduling the background work.
    const log = await VaultReconcileLog.findOne({ reconcileId }).lean();
    expect(['pending', 'running']).toContain(
      (log as Record<string, unknown> | null)?.status,
    );

    // Let the real reconcile proceed and reach a terminal status, so
    // afterEach's drain (waitForNoActiveReconciles) does not have to wait out
    // a record this test left stuck mid-flight.
    release();
    await waitForReconcileStatus(reconcileId, ['completed']);
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
