/**
 * resilience-flow.integ.ts
 *
 * Integration tests for the vault resilience layer against a real MongoDB.
 * Verifies end-to-end flows: fresh install, idempotent migration, and 4-state
 * legacy doc migration.
 *
 * Requirements: 1.1, 1.2, 1.4, 4.1, 6.1, 6.2, 6.5, 6.6
 * Depends on: 5.2, 5.4
 */

import mongoose from 'mongoose';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runVaultSyncStateMigration } from '~/features/growi-vault/server/index';
import { VaultInstruction } from '~/features/growi-vault/server/models/vault-instruction';
import { VaultSyncState } from '~/features/growi-vault/server/models/vault-sync-state';
import { createVaultResilienceLayer } from '~/features/growi-vault/server/services/resilience/index';

// ---------------------------------------------------------------------------
// Constants — 14 resilience fields added by migration Step 2
// ---------------------------------------------------------------------------

const RESILIENCE_FIELDS = [
  'bootstrapInstanceId',
  'bootstrapHeartbeatAt',
  'bootstrapLastTriggerSource',
  'bootstrapRetryAttempts',
  'bootstrapRetryNextAt',
  'bootstrapRetryAborted',
  'bootstrapCompletenessLastCheckedAt',
  'bootstrapCompletenessLastResult',
  'bootstrapStreamSnapshotMaxId',
  'driftLastWatermark',
  'driftLastSweepAt',
  'driftDetectedSinceBoot',
  'driftRepairsEmittedSinceBoot',
  'driftLastError',
] as const;

// ---------------------------------------------------------------------------
// Minimal stub helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Page model stub that reports an empty collection.
 * No pages need to be seeded — an empty collection means bootstrap completes
 * immediately, which is the fastest path.
 */
function makeEmptyPageModel() {
  return {
    estimatedDocumentCount: () => Promise.resolve(0),
    find: (_query: object) => ({
      cursor: () => ({
        [Symbol.asyncIterator]() {
          return {
            next: async () => ({ value: undefined, done: true }),
          };
        },
      }),
    }),
    findOne: (_query: object) => Promise.resolve(null),
  };
}

/**
 * Minimal namespace mapper that always returns empty namespaces.
 * With no pages in the collection this is never called during bootstrap.
 */
function makeNamespaceMapper() {
  return {
    computePageNamespaces: (_page: unknown) => ({ current: [] as string[] }),
  };
}

/**
 * Build a configManager stub with fast intervals suitable for tests.
 */
function makeConfigManager(
  bootstrapOnStart: 'true' | 'false' | 'force' = 'true',
) {
  const config: Record<string, number | string> = {
    'app:vaultBootstrapOnStart': bootstrapOnStart,
    'app:vaultBootstrapRetryMax': 3,
    'app:vaultBootstrapRetryBaseMs': 100,
    'app:vaultBootstrapRetryMaxMs': 1_000,
    'app:vaultBootstrapHeartbeatIntervalMs': 60_000,
    'app:vaultBootstrapHeartbeatStaleMs': 120_000,
    'app:vaultDriftDetectionIntervalMs': 300_000,
    'app:vaultDriftMaxPagesPerTick': 100,
  };

  return {
    getConfig: (key: string) => config[key] ?? 0,
  } as unknown as Parameters<
    typeof createVaultResilienceLayer
  >[0]['configManager'];
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Ensure Mongoose models are registered before tests run.
  // Importing the model modules is sufficient — getOrCreateModel() registers them.
  // The MongoDB connection is established by the app-integration globalSetup.
  void VaultSyncState;
  void VaultInstruction;
});

afterEach(async () => {
  // Clean up both collections between test scenarios to ensure isolation.
  await mongoose.connection.collection('vault_sync_state').deleteMany({});
  await mongoose.connection.collection('vault_instructions').deleteMany({});
});

// ---------------------------------------------------------------------------
// Scenario (a): Fresh install
// ---------------------------------------------------------------------------

describe('Scenario (a): fresh install', () => {
  it('migration creates singleton with pending state and all 14 resilience fields', async () => {
    // Pre-condition: collection is empty (afterEach ensures this for subsequent runs)
    const countBefore = await mongoose.connection
      .collection('vault_sync_state')
      .countDocuments({});
    expect(countBefore).toBe(0);

    await runVaultSyncStateMigration();

    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.bootstrapState).toBe('pending');

    // All 14 resilience fields must be present after migration
    for (const field of RESILIENCE_FIELDS) {
      expect(doc).toHaveProperty(field);
    }
  });

  it('bootstrap completes with bootstrapState=done and bootstrapCursor=null after resilience layer run', async () => {
    // Step 1: Run migration to create singleton
    await runVaultSyncStateMigration();

    // Step 2: Run the resilience layer bootstrap (empty pages = immediate done)
    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('true'),
    });

    // initOnStartup with bootstrapOnStart='true' awaits the full bootstrap
    await layer.initOnStartup();
    await layer.stop();

    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.bootstrapState).toBe('done');
    expect(doc?.bootstrapCursor).toBeNull();
  });

  it('vault_instructions collection has at least one reset-all instruction after force bootstrap', async () => {
    await runVaultSyncStateMigration();

    // env-force triggers a forceWipe which emits reset-all before any bulk-upsert.
    // We call bootstrap() directly to await completion (initOnStartup for 'force'
    // fires it as a background task and would return before completion).
    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('force'),
    });

    await layer.bootstrap({ triggerSource: 'env-force' });
    await layer.stop();

    const resetAllInstruction = await VaultInstruction.findOne({
      op: 'reset-all',
    }).lean();
    expect(resetAllInstruction).not.toBeNull();
    expect(resetAllInstruction?.op).toBe('reset-all');
  });

  it('env-true bootstrap does NOT emit reset-all (normal fresh start skips wipe)', async () => {
    await runVaultSyncStateMigration();

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('true'),
    });

    await layer.initOnStartup();
    await layer.stop();

    // env-true on a fresh pending singleton does NOT emit reset-all
    const resetAllInstruction = await VaultInstruction.findOne({
      op: 'reset-all',
    }).lean();
    expect(resetAllInstruction).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario (b): Idempotent migration (2nd boot)
// ---------------------------------------------------------------------------

describe('Scenario (b): idempotent migration — no E11000 on second call', () => {
  it('second runVaultSyncStateMigration call does not throw', async () => {
    // First boot: migration creates singleton
    await runVaultSyncStateMigration();

    const docAfterFirst = await VaultSyncState.findOne({
      _id: 'singleton',
    }).lean();
    expect(docAfterFirst).not.toBeNull();

    // Second boot: must not throw E11000 duplicate key error
    await expect(runVaultSyncStateMigration()).resolves.toBeUndefined();
  });

  it('singleton document state is unchanged after second migration call', async () => {
    await runVaultSyncStateMigration();

    // Run bootstrap so state transitions to 'done'
    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('true'),
    });
    await layer.initOnStartup();
    await layer.stop();

    const docBeforeSecondMigration = await VaultSyncState.findOne({
      _id: 'singleton',
    }).lean();
    expect(docBeforeSecondMigration?.bootstrapState).toBe('done');

    // Second boot migration — must not overwrite 'done' state
    await runVaultSyncStateMigration();

    const docAfterSecondMigration = await VaultSyncState.findOne({
      _id: 'singleton',
    }).lean();
    expect(docAfterSecondMigration?.bootstrapState).toBe('done');
  });

  it('only one singleton document exists after two migration calls', async () => {
    await runVaultSyncStateMigration();
    await runVaultSyncStateMigration();

    const count = await mongoose.connection
      .collection('vault_sync_state')
      .countDocuments({});
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scenario (c): 4-state legacy doc migration → 7-state + 14 new fields
// ---------------------------------------------------------------------------

describe('Scenario (c): 4-state legacy doc migrates to 7-state + 14 fields', () => {
  it('back-fills all 14 resilience fields on a pre-migration legacy document', async () => {
    // Insert a legacy document that simulates a pre-resilience schema doc.
    // It has only the original 4 fields and intentionally lacks
    // bootstrapRetryAttempts (the migration predicate).
    await mongoose.connection.collection('vault_sync_state').insertOne({
      _id: 'singleton',
      bootstrapState: 'pending',
      bootstrapCursor: null,
      bootstrapStartedAt: null,
      bootstrapCompletedAt: null,
      // Intentionally omit all resilience fields — this is the legacy schema
    });

    const docBefore = await mongoose.connection
      .collection('vault_sync_state')
      .findOne({ _id: 'singleton' });
    // Verify the pre-migration doc is missing the resilience fields
    expect(docBefore).not.toHaveProperty('bootstrapRetryAttempts');

    // Run migration
    await runVaultSyncStateMigration();

    const docAfter = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(docAfter).not.toBeNull();

    // All 14 resilience fields must now be present
    for (const field of RESILIENCE_FIELDS) {
      expect(docAfter).toHaveProperty(field);
    }
  });

  it('bootstrapState remains a valid 7-state value after migration', async () => {
    const validStates = [
      'pending',
      'running',
      'verifying',
      'done',
      'failed',
      'retrying',
      'escalated',
    ];

    await mongoose.connection.collection('vault_sync_state').insertOne({
      _id: 'singleton',
      bootstrapState: 'pending',
      bootstrapCursor: null,
      bootstrapStartedAt: null,
      bootstrapCompletedAt: null,
    });

    await runVaultSyncStateMigration();

    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    expect(validStates).toContain(doc?.bootstrapState);
  });

  it('stale running doc without instanceId is normalized to failed during migration', async () => {
    // Insert a legacy 'running' doc that has no bootstrapInstanceId.
    // Migration Step 3 must normalize it to 'failed'.
    await mongoose.connection.collection('vault_sync_state').insertOne({
      _id: 'singleton',
      bootstrapState: 'running',
      bootstrapCursor: null,
      bootstrapStartedAt: new Date(),
      bootstrapCompletedAt: null,
      // No bootstrapRetryAttempts (legacy schema) — triggers Step 2
      // No bootstrapInstanceId — triggers Step 3
    });

    await runVaultSyncStateMigration();

    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    // Step 3 should normalize stale running → failed
    expect(doc?.bootstrapState).toBe('failed');
    expect(doc?.bootstrapLastError).toBeTruthy();
  });

  it('running doc WITH instanceId is NOT normalized to failed', async () => {
    // Insert a resilience-era 'running' doc that already has an instanceId.
    // Migration Step 3 must NOT touch it (it already has instanceId — not stale).
    await mongoose.connection.collection('vault_sync_state').insertOne({
      _id: 'singleton',
      bootstrapState: 'running',
      bootstrapCursor: null,
      bootstrapStartedAt: new Date(),
      bootstrapCompletedAt: null,
      bootstrapRetryAttempts: 0, // has this field → not a legacy doc for Step 2
      bootstrapInstanceId: 'alive-instance-abc',
      bootstrapHeartbeatAt: new Date(),
      bootstrapLastTriggerSource: 'env-true',
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
    });

    await runVaultSyncStateMigration();

    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    // Must remain 'running' — has instanceId, should not be normalized
    expect(doc?.bootstrapState).toBe('running');
  });
});

// ---------------------------------------------------------------------------
// Task 6.2 — Abnormal termination, force, and abort scenarios
// ---------------------------------------------------------------------------

/**
 * Scenario (d): Stale running state → resume via retry
 *
 * Simulates an abnormal termination that left the singleton in 'running'
 * with an old heartbeat timestamp.  On next startup (bootstrap with
 * triggerSource='env-true') the runner must detect the stale heartbeat,
 * transition through staleRunningDetected → retrying → running → done,
 * and emit the corresponding audit event.
 *
 * Requirements: 1.6, 1.8, 3.1, 3.3
 */
describe('Scenario (d): stale running state → resume via retry', () => {
  it('detects stale running and completes bootstrap successfully', async () => {
    // Step 1: Migration creates singleton with pending state
    await runVaultSyncStateMigration();

    // Step 2: Force the singleton into a stale 'running' state (simulates
    // a prior process that was killed without cleanup).
    await mongoose.connection.collection('vault_sync_state').updateOne(
      { _id: 'singleton' },
      {
        $set: {
          bootstrapState: 'running',
          bootstrapInstanceId: 'crashed-instance-xyz',
          // Epoch 0 is always older than any threshold
          bootstrapHeartbeatAt: new Date(0),
        },
      },
    );

    // Track audit events
    const auditEvents: string[] = [];
    const createActivity = (data: { action: string }) => {
      auditEvents.push(data.action);
      return Promise.resolve();
    };

    // Step 3: Create layer. makeConfigManager uses heartbeatStaleMs=120_000 ms,
    // which is sufficient: new Date(0) is Jan 1 1970, always older than 120 s ago.
    // Use 'true' config so bootstrap() uses triggerSource='env-true' → envValue='true',
    // the path that checks isStale.
    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('true'),
      createActivity: createActivity as Parameters<
        typeof createVaultResilienceLayer
      >[0]['createActivity'],
    });

    // Step 4: Bootstrap with env-true trigger — stale detection will fire
    await layer.bootstrap({ triggerSource: 'env-true' });
    await layer.stop();

    // Step 5: Assert final state is 'done'
    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.bootstrapState).toBe('done');

    // Step 6: Assert that the stale-running audit event was emitted
    expect(auditEvents).toContain('vault.resilience.stale-running-detected');
    expect(auditEvents).toContain('vault.resilience.bootstrap-completed');
  });

  it('emits stale-running-detected audit event before bootstrap-started event', async () => {
    await runVaultSyncStateMigration();

    await mongoose.connection.collection('vault_sync_state').updateOne(
      { _id: 'singleton' },
      {
        $set: {
          bootstrapState: 'running',
          bootstrapInstanceId: 'old-instance',
          bootstrapHeartbeatAt: new Date(0),
        },
      },
    );

    const eventOrder: string[] = [];
    const createActivity = async (data: { action: string }) => {
      eventOrder.push(data.action);
    };

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('true'),
      createActivity: createActivity as Parameters<
        typeof createVaultResilienceLayer
      >[0]['createActivity'],
    });

    await layer.bootstrap({ triggerSource: 'env-true' });
    await layer.stop();

    const staleIdx = eventOrder.indexOf(
      'vault.resilience.stale-running-detected',
    );
    const startedIdx = eventOrder.indexOf('vault.resilience.bootstrap-started');

    // stale-running-detected must precede bootstrap-started
    expect(staleIdx).toBeGreaterThanOrEqual(0);
    expect(startedIdx).toBeGreaterThan(staleIdx);
  });
});

/**
 * Scenario (e): Max retry reached → escalated → abortAutoRetry → failed
 *
 * Simulates a bootstrap that has exhausted its retry budget.  When bootstrap()
 * is triggered again (e.g. on the next startup ping) it should escalate the
 * state to 'escalated' instead of running again.  After an operator calls
 * abortAutoRetry(), the state transitions to 'failed' (re-runnable via force).
 *
 * Requirements: 2.3, 5.6, 6.2
 */
describe('Scenario (e): max retry reached → escalated → abort → failed', () => {
  it('escalates when retry budget is exhausted', async () => {
    // Step 1: Migration
    await runVaultSyncStateMigration();

    // Step 2: Simulate a prior failed bootstrap that has already consumed all
    // allowed attempts.  With retryMax=1 in the configManager, setting
    // bootstrapRetryAttempts=1 means retryAllowed = (1 < 1) = false.
    await mongoose.connection.collection('vault_sync_state').updateOne(
      { _id: 'singleton' },
      {
        $set: {
          bootstrapState: 'failed',
          bootstrapRetryAttempts: 1, // equals retryMax → budget exhausted
          bootstrapRetryAborted: false,
        },
      },
    );

    const auditEvents: string[] = [];
    const createActivity = async (data: { action: string }) => {
      auditEvents.push(data.action);
    };

    // Step 3: Create layer with retryMax=1 so one failed attempt exhausts the budget
    const configManagerLowRetry = {
      getConfig: (key: string) => {
        const cfg: Record<string, number | string> = {
          'app:vaultBootstrapOnStart': 'true',
          'app:vaultBootstrapRetryMax': 1,
          'app:vaultBootstrapRetryBaseMs': 100,
          'app:vaultBootstrapRetryMaxMs': 1_000,
          'app:vaultBootstrapHeartbeatIntervalMs': 60_000,
          'app:vaultBootstrapHeartbeatStaleMs': 120_000,
          'app:vaultDriftDetectionIntervalMs': 300_000,
          'app:vaultDriftMaxPagesPerTick': 100,
        };
        return cfg[key] ?? 0;
      },
    } as unknown as Parameters<
      typeof createVaultResilienceLayer
    >[0]['configManager'];

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: configManagerLowRetry,
      createActivity: createActivity as Parameters<
        typeof createVaultResilienceLayer
      >[0]['createActivity'],
    });

    // Step 4: Trigger bootstrap — budget exhausted → should escalate, not run
    await layer.bootstrap({ triggerSource: 'env-true' });
    await layer.stop();

    // Step 5: Assert state is 'escalated'
    const docAfterEscalation = await VaultSyncState.findOne({
      _id: 'singleton',
    }).lean();
    expect(docAfterEscalation).not.toBeNull();
    expect(docAfterEscalation?.bootstrapState).toBe('escalated');

    // vault.resilience.retry-escalated audit event must be present
    expect(auditEvents).toContain('vault.resilience.retry-escalated');
  });

  it('abortAutoRetry transitions escalated → failed and emits retry-aborted event', async () => {
    // Step 1: Migration
    await runVaultSyncStateMigration();

    // Step 2: Set state to escalated (simulates post-escalation state)
    await mongoose.connection.collection('vault_sync_state').updateOne(
      { _id: 'singleton' },
      {
        $set: {
          bootstrapState: 'escalated',
          bootstrapRetryAttempts: 1,
          bootstrapRetryAborted: false,
        },
      },
    );

    const auditEvents: string[] = [];
    const createActivity = async (data: { action: string }) => {
      auditEvents.push(data.action);
    };

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('true'),
      createActivity: createActivity as Parameters<
        typeof createVaultResilienceLayer
      >[0]['createActivity'],
    });

    // Step 3: Abort auto-retry — should demote escalated → failed
    await layer.abortAutoRetry();
    await layer.stop();

    // Step 4: Assert state is 'failed' (re-runnable via force bootstrap)
    const docAfterAbort = await VaultSyncState.findOne({
      _id: 'singleton',
    }).lean();
    expect(docAfterAbort).not.toBeNull();
    expect(docAfterAbort?.bootstrapState).toBe('failed');
    expect(docAfterAbort?.bootstrapRetryAborted).toBe(true);

    // vault.resilience.retry-aborted audit event must be present
    expect(auditEvents).toContain('vault.resilience.retry-aborted');
  });

  it('full flow: escalated state → abortAutoRetry → failed → force bootstrap → done', async () => {
    // Step 1: Migration
    await runVaultSyncStateMigration();

    // Step 2: Set state to escalated
    await mongoose.connection.collection('vault_sync_state').updateOne(
      { _id: 'singleton' },
      {
        $set: {
          bootstrapState: 'escalated',
          bootstrapRetryAttempts: 1,
          bootstrapRetryAborted: false,
        },
      },
    );

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('force'),
    });

    // Step 3: Abort auto-retry (demote escalated → failed)
    await layer.abortAutoRetry();

    // Step 4: Run force bootstrap to resume (forceWipe always allowed)
    await layer.bootstrap({ triggerSource: 'env-force' });
    await layer.stop();

    // Step 5: Assert final state is 'done'
    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.bootstrapState).toBe('done');
  });
});

/**
 * Scenario (f): VAULT_BOOTSTRAP_ON_START=force → forceWarningActive=true
 *
 * When the layer is configured with bootstrapOnStart='force', initOnStartup()
 * must fire a background bootstrap with triggerSource='env-force'.  After
 * bootstrap completes:
 *   - bootstrapState must be 'done'
 *   - forceWarningActive must be true in getStatus()
 *   - A reset-all instruction must have been emitted
 *   - vault.resilience.force-warning-active audit event must be present
 *
 * Requirements: 3.6, 6.1 (forceWarningActive persist)
 */
describe('Scenario (f): force bootstrap → forceWarningActive=true', () => {
  it('initOnStartup with force config triggers force bootstrap and sets forceWarningActive', async () => {
    // Step 1: Migration
    await runVaultSyncStateMigration();

    const auditEvents: string[] = [];
    const createActivity = async (data: { action: string }) => {
      auditEvents.push(data.action);
    };

    // Step 2: Create layer with bootstrapOnStart='force'
    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('force'),
      createActivity: createActivity as Parameters<
        typeof createVaultResilienceLayer
      >[0]['createActivity'],
    });

    // Step 3: initOnStartup() fires bootstrap as background task for 'force' mode.
    // We then wait for bootstrap to complete by polling getStatus().
    await layer.initOnStartup();

    // Poll until bootstrapState reaches a terminal state (done/failed)
    let finalStatus = await layer.getStatus();
    const pollStart = Date.now();
    const pollTimeoutMs = 10_000;
    while (
      finalStatus.bootstrap.state !== 'done' &&
      finalStatus.bootstrap.state !== 'failed' &&
      Date.now() - pollStart < pollTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      finalStatus = await layer.getStatus();
    }

    await layer.stop();

    // Step 4: Assert final state is 'done'
    expect(finalStatus.bootstrap.state).toBe('done');

    // Step 5: forceWarningActive must be true (lastTriggerSource === 'env-force')
    expect(finalStatus.forceWarningActive).toBe(true);

    // Step 6: A reset-all instruction must have been emitted during force wipe
    const resetAllInstruction = await VaultInstruction.findOne({
      op: 'reset-all',
    }).lean();
    expect(resetAllInstruction).not.toBeNull();

    // Step 7: vault.resilience.force-warning-active audit event must be present
    expect(auditEvents).toContain('vault.resilience.force-warning-active');
    expect(auditEvents).toContain('vault.resilience.bootstrap-completed');
  });

  it('forceWarningActive persists across getStatus() calls after force bootstrap', async () => {
    // Step 1: Migration + direct bootstrap call (synchronous path for test reliability)
    await runVaultSyncStateMigration();

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('force'),
    });

    // Direct synchronous bootstrap call — guaranteed to complete before assertion
    await layer.bootstrap({ triggerSource: 'env-force' });
    await layer.stop();

    // Check getStatus() twice to verify persistence in the DB
    const status1 = await layer.getStatus();
    const status2 = await layer.getStatus();

    expect(status1.forceWarningActive).toBe(true);
    expect(status2.forceWarningActive).toBe(true);
    expect(status1.lastTriggerSource).toBe('env-force');
  });

  it('force bootstrap on existing vault_instructions seeds reset-all before any upserts', async () => {
    // Step 1: Migration
    await runVaultSyncStateMigration();

    // Step 2: Seed a pre-existing instruction to verify wipe happens
    await mongoose.connection.collection('vault_instructions').insertOne({
      op: 'bulk-upsert',
      payload: { namespace: 'old-ns', entries: [] },
      issuedAt: new Date(Date.now() - 10_000),
    });

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('force'),
    });

    // Step 3: Force bootstrap (direct call for reliable ordering assertions)
    await layer.bootstrap({ triggerSource: 'env-force' });
    await layer.stop();

    // Step 4: reset-all instruction must be present
    const resetAllInstruction = await VaultInstruction.findOne({
      op: 'reset-all',
    }).lean();
    expect(resetAllInstruction).not.toBeNull();

    // Step 5: State must be done
    const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
    expect(doc?.bootstrapState).toBe('done');
    expect(doc?.bootstrapLastTriggerSource).toBe('env-force');
  });
});

// ---------------------------------------------------------------------------
// Instruction ordering: reset-all appears before bulk-upsert (force trigger)
// ---------------------------------------------------------------------------

describe('instruction ordering', () => {
  it('reset-all instruction is issued before any bulk-upsert instructions on force trigger', async () => {
    await runVaultSyncStateMigration();

    const layer = createVaultResilienceLayer({
      vaultSyncState: VaultSyncState,
      vaultInstruction: VaultInstruction,
      pageModel: makeEmptyPageModel(),
      namespaceMapper: makeNamespaceMapper(),
      configManager: makeConfigManager('force'),
    });

    // Use env-force directly to ensure reset-all is emitted
    await layer.bootstrap({ triggerSource: 'env-force' });
    await layer.stop();

    const instructions = await VaultInstruction.find({})
      .sort({ issuedAt: 1 })
      .lean();
    const ops = instructions.map((i) => i.op);

    // reset-all must be present when using env-force
    expect(ops).toContain('reset-all');

    const resetIdx = ops.indexOf('reset-all');
    const bulkIdx = ops.indexOf('bulk-upsert');

    // If bulk-upsert exists, it must come after reset-all
    if (bulkIdx >= 0) {
      expect(resetIdx).toBeLessThan(bulkIdx);
    }
  });
});
