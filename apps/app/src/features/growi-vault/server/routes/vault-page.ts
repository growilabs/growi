import type { Router } from 'express';
import express from 'express';

import loginRequiredFactory from '~/server/middlewares/login-required.js';
import loggerFactory from '~/utils/logger/index.js';

import type { VaultReconcileService } from '../services/reconcile/index.js';

const logger = loggerFactory('growi:features:growi-vault:routes:vault-page');

// ============================================================================
// Types
// ============================================================================

/**
 * Dependencies injected into the VaultPageRouter factory.
 * Explicit injection allows unit tests to supply stubs without touching singletons.
 */
export interface VaultPageRouterDeps {
  /**
   * VaultReconcileService instance for user-triggered reconcile endpoints.
   * Must be provided at runtime (wired in task 3.3). When omitted, the reconcile
   * endpoint returns 500 (service not initialised).
   */
  readonly reconcileService?: VaultReconcileService;
  /**
   * Crowi instance used to build login-required middleware.
   * When omitted the router skips loginRequired (test mode only).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly crowi?: any;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maps a ReconcileRejectReason to the appropriate HTTP status code.
 * Same mapping as vault-admin.ts (admin route) to ensure consistent API behaviour.
 */
const REJECT_REASON_TO_HTTP_STATUS: Record<string, number> = {
  'invalid-target': 400,
  'bootstrap-not-done': 409,
  'page-count-exceeds-user-limit': 422,
  'page-count-exceeds-admin-limit': 422,
  'user-concurrency-limit': 429,
  'system-concurrency-limit': 429,
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an Express router that exposes the general-user Vault page API.
 *
 * Endpoints:
 *   POST /vault/page/reconcile — user-triggered targeted reconcile
 *
 * Protected by loginRequiredFactory only (no adminRequired).
 * Passes isAdmin: false to VaultReconcileService.submit so ACL evaluation
 * is scoped to pages the user has write permission on.
 */
export const createVaultPageRouter = (
  deps: VaultPageRouterDeps = {},
): Router => {
  const { crowi, reconcileService } = deps;

  const router = express.Router();

  // Build auth middleware when crowi is available (skipped in unit tests).
  // Only loginRequired is needed — no adminRequired for user-facing endpoint.
  const authMiddlewares = crowi != null ? [loginRequiredFactory(crowi)] : [];

  // --------------------------------------------------------------------------
  // POST /page/reconcile
  // --------------------------------------------------------------------------

  /**
   * User-triggered targeted reconcile.
   *
   * Accepts { targetType, targetPath } and submits to VaultReconcileService
   * with isAdmin: false. Returns 202 on accept or an error HTTP status based on
   * the reject reason:
   *   invalid-target                  → 400
   *   bootstrap-not-done              → 409
   *   page-count-exceeds-*-limit      → 422
   *   *-concurrency-limit             → 429
   *
   * ACL evaluation (req 2.3, 2.4): the service filters out pages the user
   * does not have write permission on. The endpoint itself does not perform
   * ACL checks — it delegates entirely to VaultReconcileService.submit.
   */
  router.post('/page/reconcile', ...authMiddlewares, async (req, res) => {
    if (reconcileService == null) {
      logger.error('VaultReconcileService is not initialised');
      return res
        .status(500)
        .json({ ok: false, error: 'Reconcile service not available' });
    }

    const { targetType, targetPath } = req.body as {
      targetType: string;
      targetPath: string;
    };

    const user = (req as typeof req & { user?: { _id: string } }).user;
    const userId = user?._id ?? 'unknown';

    try {
      const result = await reconcileService.submit({
        targetType: targetType as 'page' | 'sub-tree',
        targetPath,
        triggeredBy: { userId: String(userId), isAdmin: false },
      });

      if (result.status === 'accepted') {
        return res.status(202).json({ ok: true, data: result });
      }

      // Rejected — map reason to HTTP status.
      const httpStatus = REJECT_REASON_TO_HTTP_STATUS[result.reason] ?? 500;
      return res.status(httpStatus).json({ ok: false, data: result });
    } catch (err) {
      logger.error({ err }, 'Failed to submit reconcile request');
      return res
        .status(500)
        .json({ ok: false, error: 'Internal server error' });
    }
  });

  return router;
};
