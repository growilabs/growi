/**
 * resilience/index.ts — public barrel for the vault resilience layer.
 *
 * This is the ONLY entry point for external consumers. Internal modules
 * (state-machine, heartbeat, trigger-resolver, retry-policy, runner, drift-detector)
 * are NOT re-exported — callers must go through this barrel.
 *
 * Exported surface:
 *   - createVaultResilienceLayer(deps): VaultResilienceLayer   (factory)
 *   - VaultResilienceLayerDeps                                  (dep interface)
 *   - VaultResilienceLayer                                      (return interface)
 *   - ResilienceStatus / BootstrapStatus / RetryStatus / DriftStatus  (status types)
 */

import type { VaultInstructionModel } from '~/features/growi-vault/server/models/vault-instruction.js';
import type { VaultSyncStateModel } from '~/features/growi-vault/server/models/vault-sync-state.js';
import { createBootstrapRunner } from '~/features/growi-vault/server/services/resilience/bootstrap-runner.js';
import { createDriftDetector } from '~/features/growi-vault/server/services/resilience/drift-detector.js';

import type {
  BootstrapRunnerDeps,
  VaultResilienceLayer,
} from './bootstrap-runner.js';
import type { RetryConfig } from './retry-policy.js';

// ---------------------------------------------------------------------------
// Re-export status types and the VaultResilienceLayer interface.
// These are the only symbols that cross the barrel boundary.
// ---------------------------------------------------------------------------

export type {
  BootstrapStatus,
  DriftStatus,
  ResilienceStatus,
  RetryStatus,
  VaultResilienceLayer,
} from './bootstrap-runner.js';

// ---------------------------------------------------------------------------
// Factory dependency interface
// ---------------------------------------------------------------------------

/**
 * Dependency interface for createVaultResilienceLayer.
 *
 * Callers inject Mongoose models, the namespace mapper, and a configManager.
 * The factory extracts all numeric config values and constructs the internal
 * sub-module dependency graphs.
 */
export interface VaultResilienceLayerDeps {
  /** VaultSyncState Mongoose model. */
  vaultSyncState: Pick<
    VaultSyncStateModel,
    'findOneAndUpdate' | 'findOne' | 'updateOne'
  >;

  /** VaultInstruction Mongoose model. */
  vaultInstruction: Pick<VaultInstructionModel, 'create' | 'findOne'>;

  /** Page Mongoose model (minimal read-only interface). */
  pageModel: BootstrapRunnerDeps['pageModel'];

  /** Namespace mapper for ACL-based page → namespace routing. */
  namespaceMapper: BootstrapRunnerDeps['namespaceMapper'];

  /**
   * Configuration manager used to read all resilience-related config values.
   * Typed as a minimal interface so consumers do not need to import the full
   * configManager type.
   */
  configManager: {
    getConfig(key: 'app:vaultBootstrapOnStart'): 'true' | 'false' | 'force';
    getConfig(key: 'app:vaultBootstrapRetryMax'): number;
    getConfig(key: 'app:vaultBootstrapRetryBaseMs'): number;
    getConfig(key: 'app:vaultBootstrapRetryMaxMs'): number;
    getConfig(key: 'app:vaultBootstrapHeartbeatIntervalMs'): number;
    getConfig(key: 'app:vaultBootstrapHeartbeatStaleMs'): number;
    getConfig(key: 'app:vaultDriftDetectionIntervalMs'): number;
    getConfig(key: 'app:vaultDriftMaxPagesPerTick'): number;
  };

  /** Optional audit log activity factory. */
  createActivity?: (data: unknown) => Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createVaultResilienceLayer — top-level factory that assembles the full
 * vault resilience layer from config-level dependencies.
 *
 * Internal wiring:
 *   1. Extracts numeric config values from configManager.
 *   2. Constructs RetryConfig, heartbeat config, and drift config objects.
 *   3. Calls createBootstrapRunner(...) to obtain the core VaultResilienceLayer.
 *   4. Calls createDriftDetector(...) to obtain the DriftDetector.
 *   5. Returns a combined VaultResilienceLayer that:
 *      - Delegates bootstrap(), initOnStartup(), getStatus(), abortAutoRetry() to the runner.
 *      - On stop(): calls both runner.stop() and driftDetector.stop().
 *
 * Barrel design principle: consumers import ONLY from this barrel. The runner,
 * drift detector, heartbeat, state machine, trigger resolver, and retry policy
 * are internal implementation details and MUST NOT be imported directly.
 */
export function createVaultResilienceLayer(
  deps: VaultResilienceLayerDeps,
): VaultResilienceLayer {
  const {
    vaultSyncState,
    vaultInstruction,
    pageModel,
    namespaceMapper,
    configManager,
    createActivity,
  } = deps;

  // -------------------------------------------------------------------------
  // Step 1: Extract config values
  // -------------------------------------------------------------------------

  const bootstrapOnStart = configManager.getConfig('app:vaultBootstrapOnStart');

  const retryConfig: RetryConfig = {
    maxAttempts: configManager.getConfig('app:vaultBootstrapRetryMax'),
    baseBackoffMs: configManager.getConfig('app:vaultBootstrapRetryBaseMs'),
    maxBackoffMs: configManager.getConfig('app:vaultBootstrapRetryMaxMs'),
  };

  const heartbeatIntervalMs = configManager.getConfig(
    'app:vaultBootstrapHeartbeatIntervalMs',
  );
  const heartbeatStaleMs = configManager.getConfig(
    'app:vaultBootstrapHeartbeatStaleMs',
  );
  const driftIntervalMs = configManager.getConfig(
    'app:vaultDriftDetectionIntervalMs',
  );
  const driftMaxPagesPerTick = configManager.getConfig(
    'app:vaultDriftMaxPagesPerTick',
  );

  // -------------------------------------------------------------------------
  // Step 2: Assemble sub-modules
  // -------------------------------------------------------------------------

  const runnerDeps: BootstrapRunnerDeps = {
    vaultSyncState,
    vaultInstruction,
    pageModel,
    namespaceMapper,
    retryConfig,
    heartbeatIntervalMs,
    heartbeatStaleMs,
    createActivity: createActivity as BootstrapRunnerDeps['createActivity'],
    // Read the env value lazily so getStatus() reflects the *current* value
    // (configManager may be updated at runtime — though in practice the env
    // is fixed at process start, this keeps the AND check honest).
    getBootstrapOnStartEnv: () =>
      configManager.getConfig('app:vaultBootstrapOnStart'),
  };

  const runner = createBootstrapRunner(runnerDeps);

  const driftDetector = createDriftDetector({
    vaultSyncState,
    vaultInstruction,
    pageModel,
    namespaceMapper,
    maxPagesPerTick: driftMaxPagesPerTick,
    intervalMs: driftIntervalMs,
    createActivity,
  });

  // -------------------------------------------------------------------------
  // Step 3: Return combined VaultResilienceLayer
  // -------------------------------------------------------------------------

  return {
    bootstrap: (opts) => runner.bootstrap(opts),

    /**
     * Startup initialisation:
     *  - Reads env var to determine trigger source (env-true / env-force / skip).
     *  - Fires or awaits bootstrap with the right trigger source when env is 'true' or 'force'.
     *  - Always starts the drift detector regardless of the env value so that
     *    drift sweeps run even when bootstrapOnStart is 'false'.
     *
     * For 'true': awaits runner.initOnStartup() which ensures the singleton doc
     * exists, then awaits the full bootstrap stream to completion (blocking).
     * The drift detector starts after bootstrap finishes.
     * For 'force': fires bootstrap('env-force') as a background task (no await),
     * then immediately starts the drift detector.
     * For 'false' / unknown: only starts the drift detector.
     */
    async initOnStartup(): Promise<void> {
      if (bootstrapOnStart === 'true') {
        await runner.initOnStartup();
      } else if (bootstrapOnStart === 'force') {
        // runner.initOnStartup() hardcodes env-true; for force we call bootstrap
        // directly so the trigger resolver sees envValue='force' → forceWipe.
        runner.bootstrap({ triggerSource: 'env-force' }).catch((err) => {
          // Error already logged by runner internally; suppress unhandled rejection at barrel boundary.
          void err;
        });
      }
      // Drift detector always starts so it can sweep once bootstrapState reaches 'done'.
      driftDetector.start();
    },

    getStatus: () => runner.getStatus(),

    abortAutoRetry: () => runner.abortAutoRetry(),

    async stop(): Promise<void> {
      await runner.stop();
      driftDetector.stop();
    },
  };
}
