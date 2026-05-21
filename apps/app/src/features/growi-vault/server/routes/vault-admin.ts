import type { StorageStatsResponse } from '@growi/core/dist/interfaces/vault';
import type { Router } from 'express';
import express from 'express';
import { body, validationResult } from 'express-validator';

import adminRequiredFactory from '~/server/middlewares/admin-required';
import loginRequiredFactory from '~/server/middlewares/login-required';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import type {
  ResilienceStatus,
  VaultBootstrapper,
} from '../services/vault-bootstrapper';
import { vaultBootstrapperFactory } from '../services/vault-bootstrapper';
import type { VaultManagerClient } from '../services/vault-manager-client';
import { vaultManagerClient as defaultManagerClient } from '../services/vault-manager-client';
import { vaultNamespaceMapper } from '../services/vault-namespace-mapper';

const logger = loggerFactory('growi:features:growi-vault:routes:vault-admin');

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies injected into the VaultAdminRouter factory.
 * Explicit injection allows unit tests to supply stubs without touching singletons.
 */
export interface VaultAdminRouterDeps {
  /** VaultBootstrapper instance; defaults to the module-level singleton. */
  readonly bootstrapper?: VaultBootstrapper;
  /** VaultManagerClient instance; defaults to the module-level singleton. */
  readonly managerClient?: VaultManagerClient;
  /**
   * Crowi instance used to build admin-required middleware.
   * When omitted the router skips loginRequired/adminRequired (test mode only).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly crowi?: any;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an Express router that exposes the admin-only Vault management API.
 *
 * Endpoints:
 *   GET  /_api/v3/vault/status    — bootstrap status + storage stats
 *   POST /_api/v3/vault/bootstrap — trigger bootstrap
 *   PUT  /_api/v3/vault/enabled   — toggle vaultEnabled flag
 */
export const createVaultAdminRouter = (
  deps: VaultAdminRouterDeps = {},
): Router => {
  const {
    crowi,
    bootstrapper: injectedBootstrapper,
    managerClient: injectedManagerClient = defaultManagerClient,
  } = deps;

  // Resolve the bootstrapper: prefer injected, fall back to creating one from
  // the default namespace mapper.
  const bootstrapper =
    injectedBootstrapper ?? vaultBootstrapperFactory(vaultNamespaceMapper);

  const router = express.Router();

  // Build auth middleware when crowi is available (skipped in unit tests).
  const authMiddlewares =
    crowi != null
      ? [loginRequiredFactory(crowi), adminRequiredFactory(crowi)]
      : [];

  // --------------------------------------------------------------------------
  // GET /status
  // --------------------------------------------------------------------------

  /**
   * Return the current bootstrap status and, if available, storage statistics
   * fetched from vault-manager.
   *
   * Even when vault-manager is unreachable the bootstrap status is still returned
   * so the admin UI can display progress information without an error.
   */
  router.get('/status', ...authMiddlewares, async (_req, res) => {
    try {
      const bootstrapStatus = await bootstrapper.getStatus();

      // Fetch storage stats from vault-manager. Treat any error as non-fatal:
      // the admin UI can render the bootstrap status even without storage info.
      let storageStats: StorageStatsResponse | null = null;
      try {
        storageStats = await injectedManagerClient.getStorageStats();
      } catch (err) {
        logger.warn(
          { err },
          'Failed to fetch storage stats from vault-manager',
        );
      }

      return res.json({
        ok: true,
        data: {
          bootstrapState: bootstrapStatus.state,
          processed: bootstrapStatus.processed,
          totalEstimated: bootstrapStatus.totalEstimated,
          startedAt: bootstrapStatus.startedAt,
          completedAt: bootstrapStatus.completedAt,
          lastError: bootstrapStatus.lastError,
          storageStats,
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to retrieve vault status');
      return res
        .status(500)
        .json({ ok: false, error: 'Internal server error' });
    }
  });

  // --------------------------------------------------------------------------
  // POST /bootstrap
  // --------------------------------------------------------------------------

  /**
   * Trigger the bootstrap process.
   *
   * Returns 409 Conflict when bootstrap is already running to prevent duplicate runs.
   * The bootstrapper itself also guards against double-start, but we surface the
   * 409 here so the UI can display a meaningful message without polling.
   */
  router.post('/bootstrap', ...authMiddlewares, async (_req, res) => {
    try {
      const status = await bootstrapper.getStatus();

      if (status.state === 'running') {
        return res
          .status(409)
          .json({ ok: false, error: 'Bootstrap is already running' });
      }

      // Fire-and-forget: bootstrap is a long-running background operation.
      // We return 200 immediately and let the client poll /status for progress.
      bootstrapper.start({ triggerSource: 'admin-ui' }).catch((err) => {
        logger.error({ err }, 'Bootstrap failed asynchronously');
      });

      return res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Failed to start vault bootstrap');
      return res
        .status(500)
        .json({ ok: false, error: 'Internal server error' });
    }
  });

  // --------------------------------------------------------------------------
  // GET /resilience-status
  // --------------------------------------------------------------------------

  /**
   * Return the full ResilienceStatus (bootstrap + retry + drift + trigger info).
   *
   * Unlike GET /status (which returns a flat bootstrap-only subset for backward
   * compat), this endpoint exposes the entire ResilienceStatus structure so the
   * admin UI can render retry and drift information without extra round-trips.
   */
  router.get('/resilience-status', ...authMiddlewares, async (_req, res) => {
    try {
      const resilienceStatus: ResilienceStatus =
        await bootstrapper.getResilienceStatus();
      return res.json({ ok: true, data: resilienceStatus });
    } catch (err) {
      logger.error({ err }, 'Failed to retrieve resilience status');
      return res
        .status(500)
        .json({ ok: false, error: 'Internal server error' });
    }
  });

  // --------------------------------------------------------------------------
  // POST /retry/abort
  // --------------------------------------------------------------------------

  /**
   * Abort the current auto-retry schedule.
   *
   * Returns 409 Conflict when the bootstrap state is not in a retriable state
   * (i.e., not 'failed', 'retrying', or 'escalated'), because aborting retry
   * is meaningless when no retry is active or pending.
   */
  router.post('/retry/abort', ...authMiddlewares, async (_req, res) => {
    try {
      const status = await bootstrapper.getStatus();
      const retriableStates = ['failed', 'retrying', 'escalated'] as const;
      if (
        !retriableStates.includes(
          status.state as (typeof retriableStates)[number],
        )
      ) {
        return res.status(409).json({
          ok: false,
          error: `Cannot abort retry: bootstrap is in '${status.state}' state`,
        });
      }

      await bootstrapper.abortAutoRetry();
      return res.json({ ok: true, data: { aborted: true } });
    } catch (err) {
      logger.error({ err }, 'Failed to abort auto-retry');
      return res
        .status(500)
        .json({ ok: false, error: 'Internal server error' });
    }
  });

  // --------------------------------------------------------------------------
  // PUT /enabled
  // --------------------------------------------------------------------------

  /**
   * Toggle the vaultEnabled feature flag.
   *
   * Expects a JSON body: { "enabled": boolean }
   */
  router.put(
    '/enabled',
    ...authMiddlewares,
    body('enabled')
      .exists()
      .withMessage('enabled field is required')
      .isBoolean()
      .withMessage('enabled must be a boolean'),
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ ok: false, errors: errors.array() });
      }

      const { enabled } = req.body as { enabled: boolean };

      try {
        await configManager.updateConfigs({ 'app:vaultEnabled': enabled });
        return res.json({ ok: true });
      } catch (err) {
        logger.error({ err }, 'Failed to update vaultEnabled config');
        return res
          .status(500)
          .json({ ok: false, error: 'Internal server error' });
      }
    },
  );

  return router;
};
