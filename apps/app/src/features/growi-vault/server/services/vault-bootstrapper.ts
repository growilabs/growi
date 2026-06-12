/**
 * vault-bootstrapper.ts — backward-compatible facade over the vault resilience layer.
 *
 * External contract (unchanged):
 *   - VaultBootstrapper interface with start() and getStatus()
 *   - createVaultBootstrapper(namespaceMapper) factory signature
 *   - BootstrapStatus type (re-exported as alias to ResilienceStatus['bootstrap'])
 *   - vaultBootstrapperFactory alias
 *
 * Internal implementation delegates to createVaultResilienceLayer so that all
 * resilience behaviour (heartbeat, retry, drift detection) is active in production.
 *
 * Consumers (vault-admin route, features/growi-vault/server/index.ts) import from
 * this module and can continue to do so without any changes.
 */

import mongoose from 'mongoose';

import { VaultInstruction } from '~/features/growi-vault/server/models/vault-instruction.js';
import { VaultSyncState } from '~/features/growi-vault/server/models/vault-sync-state.js';
import {
  createVaultResilienceLayer,
  type ResilienceStatus,
} from '~/features/growi-vault/server/services/resilience/index.js';
import type { PageDocument, PageModel } from '~/server/models/page.js';
import { configManager } from '~/server/service/config-manager/index.js';
import loggerFactory from '~/utils/logger/index.js';

import type { VaultNamespaceMapper } from './vault-namespace-mapper.js';

export type { ResilienceStatus };

const logger = loggerFactory(
  'growi:features:growi-vault:service:vault-bootstrapper',
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of entries packed into a single bulk-upsert instruction per namespace.
 * Kept for backward compatibility — actual chunking is handled by the resilience layer. */
export const CHUNK_SIZE = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * BootstrapStatus — backward-compatible type alias for ResilienceStatus['bootstrap'].
 *
 * Consumers that import BootstrapStatus from this module will get the same type
 * as ResilienceStatus.bootstrap from the resilience layer.
 */
export type BootstrapStatus = ResilienceStatus['bootstrap'];

/**
 * VaultBootstrapper — public interface for consumers.
 *
 * The getStatus() return type is intentionally kept as BootstrapStatus (the
 * bootstrap-only subset of ResilienceStatus) so that existing callers that
 * access status.state, status.processed, etc. at the top level continue to work.
 *
 * initOnStartup() and stop() expose the resilience layer lifecycle to the
 * vault feature initialisation in index.ts (task 5.2):
 *   - initOnStartup(): reads env var, dispatches bootstrap if needed, starts drift detector.
 *   - stop(): stops heartbeat and drift scheduler on graceful shutdown.
 */
export interface VaultBootstrapper {
  /**
   * Kill switch: forcibly wipe all vault repositories (via reset-all instruction)
   * and re-seed from the current page set. This is the only admin-triggered
   * bootstrap entry point — a separate `start()` for the Prepare button used
   * to exist but was removed because it mapped to the same forceWipe path
   * (functionally identical to wipe) and confused admins.
   *
   * Returns once the resilience layer signals state='running' via the optional
   * `onRunning` callback; the full bootstrap pipeline continues in the
   * background. Background failures surface via bootstrapState='failed', not
   * through this promise.
   */
  wipeAndRebootstrap(opts: {
    triggerSource: 'admin-force-wipe';
    onRunning?: () => void;
  }): Promise<void>;
  getStatus(): Promise<BootstrapStatus>;
  /** Return the full ResilienceStatus (bootstrap + retry + drift + trigger info). */
  getResilienceStatus(): Promise<ResilienceStatus>;
  /** Abort the current auto-retry schedule. */
  abortAutoRetry(): Promise<void>;
  initOnStartup(): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function that creates a VaultBootstrapper implementation backed by
 * the full vault resilience layer.
 *
 * Signature is kept identical to the previous implementation so that existing
 * consumers (vault-admin route, index.ts) require no changes.
 *
 * The factory acquires all additional dependencies (VaultSyncState, VaultInstruction,
 * Page model, configManager) directly rather than through the signature, mirroring
 * the approach used by the old implementation.
 */
export const createVaultBootstrapper = (
  namespaceMapper: VaultNamespaceMapper,
): VaultBootstrapper => {
  // Build the Page model interface expected by the resilience layer.
  // We defer the mongoose.model('Page') call to bootstrap time rather than
  // factory time so tests can set up mocks before the call executes.
  const getPageModel = () =>
    mongoose.model<PageDocument, PageModel>('Page') as unknown as Parameters<
      typeof createVaultResilienceLayer
    >[0]['pageModel'];

  // Assemble resilience layer deps. All models are imported directly so that
  // vi.mock() in test files continues to intercept them.
  const resilienceLayer = createVaultResilienceLayer({
    vaultSyncState: VaultSyncState,
    vaultInstruction: VaultInstruction,
    // pageModel is lazily resolved per start() call via a proxy-style wrapper
    pageModel: {
      estimatedDocumentCount: () => getPageModel().estimatedDocumentCount(),
      find: (query: object) => getPageModel().find(query as never),
      findOne: (
        query: object,
        projection?: object | null,
        options?: object | null,
      ) => getPageModel().findOne(query as never, projection, options),
    },
    namespaceMapper: {
      computePageNamespaces: (page) =>
        namespaceMapper.computePageNamespaces(page as never),
    },
    configManager,
  });

  logger.debug(
    'VaultBootstrapper facade created (delegates to resilience layer)',
  );

  return {
    /**
     * Force wipe + re-bootstrap. Used by the admin UI "Wipe Vault" kill switch.
     *
     * Delegates to the resilience layer's bootstrap() with the dedicated
     * 'admin-force-wipe' triggerSource so audit logs can distinguish admin
     * action from env-driven bootstrap.
     */
    async wipeAndRebootstrap(opts: {
      triggerSource: 'admin-force-wipe';
      onRunning?: () => void;
    }): Promise<void> {
      await resilienceLayer.bootstrap({
        triggerSource: opts.triggerSource,
        onRunning: opts.onRunning,
      });
    },

    /**
     * Return the current bootstrap status from the resilience layer.
     *
     * Returns the bootstrap subset of ResilienceStatus to maintain backward
     * compatibility with callers that access status.state, status.processed, etc.
     */
    async getStatus(): Promise<BootstrapStatus> {
      const status = await resilienceLayer.getStatus();
      return status.bootstrap;
    },

    /**
     * Return the full ResilienceStatus (bootstrap + retry + drift + trigger info).
     *
     * Used by GET /vault/resilience-status to expose the complete status to the
     * admin UI without losing any resilience layer fields.
     */
    getResilienceStatus(): Promise<ResilienceStatus> {
      return resilienceLayer.getStatus();
    },

    /**
     * Abort the current auto-retry schedule.
     *
     * Delegates to the resilience layer which persists the abort flag and
     * downgrades 'escalated' → 'failed' so operators can inspect the state.
     */
    async abortAutoRetry(): Promise<void> {
      await resilienceLayer.abortAutoRetry();
    },

    /**
     * Startup lifecycle: reads env var, dispatches bootstrap with the right
     * trigger source if enabled, and always starts the drift detector.
     *
     * Delegates to resilienceLayer.initOnStartup() which handles the env-aware
     * dispatch logic internally.
     */
    async initOnStartup(): Promise<void> {
      await resilienceLayer.initOnStartup();
    },

    /**
     * Stop lifecycle: halts heartbeat and drift scheduler.
     *
     * Must be called on graceful shutdown (SIGTERM / SIGINT) to release
     * setInterval handles so the process can exit cleanly.
     */
    async stop(): Promise<void> {
      await resilienceLayer.stop();
    },
  };
};

/**
 * Default singleton instance. Production code should call
 * createVaultBootstrapper(vaultNamespaceMapper) during app startup and store
 * the result in the DI container; this export is provided as a convenience.
 */
export { createVaultBootstrapper as vaultBootstrapperFactory };
