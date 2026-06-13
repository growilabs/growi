/**
 * reconcile-service.ts
 *
 * VaultReconcileService — the central acceptance gate + dispatcher for
 * user-triggered targeted reconcile.
 *
 * Acceptance gate (synchronous, cheap path):
 *   1. TargetResolver validates targetPath syntax → invalid-target
 *   2. VaultResilienceLayer.getStatus() bootstrap check → bootstrap-not-done
 *   3. pageModel.findOne(path) → null means invalid-target
 *   4. plannedPageCount vs roleLimit → page-count-exceeds-*-limit
 *   5. AclEvaluator.buildEligibleQuery → { eligibleQuery }
 *   6. HistoryStore.create(status: pending)
 *   7. ConcurrencyController.tryRunInBackground → if ok:false → rejected
 *   8. Return accepted { reconcileId, descendantCount }
 *
 * IMPORTANT: countDocuments is NEVER called during the acceptance gate.
 * Page count estimation is based solely on pages.descendantCount (req 6.2).
 *
 * Requirements: 1.1, 1.2, 1.3, 2.6, 4.2, 4.3, 4.4, 5.4, 6.1, 6.2, 6.3,
 *               6.4, 6.5, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4
 */

import crypto from 'node:crypto';

import loggerFactory from '~/utils/logger/index.js';

import type { AclEvaluator } from './reconcile-acl-evaluator.js';
import type { ConcurrencyController } from './reconcile-concurrency-controller.js';
import type {
  HistoryStore,
  ReconcileLogEntry,
  ReconcileRejectReason,
  ReconcileTargetType,
} from './reconcile-history-store.js';
import type { ReconcileOrchestrator } from './reconcile-orchestrator.js';

const logger = loggerFactory(
  'growi:features:growi-vault:service:reconcile:service',
);

// ---------------------------------------------------------------------------
// Audit action constants
// ---------------------------------------------------------------------------

const ACTION_RECONCILE_REJECTED = 'vault.reconcile.rejected';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type { ReconcileLogEntry, ReconcileRejectReason, ReconcileTargetType };

export interface ReconcileRequest {
  readonly targetType: ReconcileTargetType;
  readonly targetPath: string;
  readonly triggeredBy: {
    readonly userId: string;
    readonly isAdmin: boolean;
  };
}

export type ReconcileSubmitResult =
  | {
      readonly status: 'accepted';
      readonly reconcileId: string;
      readonly descendantCount: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ReconcileRejectReason;
      readonly descendantCount?: number;
      readonly roleLimit?: number;
    };

export interface VaultReconcileService {
  submit(request: ReconcileRequest): Promise<ReconcileSubmitResult>;
  listHistory(opts: {
    limit?: number;
    offset?: number;
  }): Promise<readonly ReconcileLogEntry[]>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dependency types
// ---------------------------------------------------------------------------

/** Minimal slice of PageModel used by ReconcileService. */
export interface ReconcilePageModel {
  findOne(
    filter: Record<string, unknown>,
    projection?: Record<string, unknown>,
  ): {
    lean(): Promise<{
      _id: unknown;
      path?: string | null;
      descendantCount?: number | null;
      grant?: unknown;
      grantedUsers?: unknown[];
      grantedGroups?: unknown[];
    } | null>;
  };
}

/** Minimal slice of VaultResilienceLayer used by ReconcileService. */
export interface ReconcileResilienceLayer {
  getStatus(): Promise<{ bootstrap: { state: string } }>;
}

/** Audit activity factory signature used internally. */
type CreateActivity = (data: {
  action: string;
  user: null;
  ip: string;
  data?: Record<string, unknown>;
}) => Promise<unknown>;

/** Config manager slice needed by ReconcileService. */
export interface ReconcileConfigManager {
  getConfig(key: 'app:vaultReconcileMaxPagesPerUserRequest'): number;
  getConfig(key: 'app:vaultReconcileMaxPagesPerAdminRequest'): number;
  getConfig(key: 'app:vaultReconcileRejectWhenBootstrapNotDone'): boolean;
}

/** TargetResolver interface (thin interface to avoid import cycle). */
export interface TargetResolver {
  resolveTarget(
    targetType: ReconcileTargetType,
    targetPath: string,
  ):
    | { ok: true; query: Record<string, unknown> }
    | { ok: false; reason: 'invalid-target' };
}

/** All dependencies for VaultReconcileService. */
export interface VaultReconcileServiceDeps {
  pageModel: ReconcilePageModel;
  targetResolver: TargetResolver;
  aclEvaluator: AclEvaluator;
  concurrencyController: ConcurrencyController;
  historyStore: HistoryStore;
  orchestrator: ReconcileOrchestrator;
  resilienceLayer: ReconcileResilienceLayer;
  configManager: ReconcileConfigManager;
  createActivity?: CreateActivity;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createVaultReconcileService(
  deps: VaultReconcileServiceDeps,
): VaultReconcileService {
  const {
    pageModel,
    targetResolver,
    aclEvaluator,
    concurrencyController,
    historyStore,
    orchestrator,
    resilienceLayer,
    configManager,
    createActivity,
  } = deps;

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  function generateReconcileId(): string {
    return crypto.randomUUID();
  }

  async function emitRejectedAudit(
    reconcileId: string,
    reason: ReconcileRejectReason,
    data?: Record<string, unknown>,
  ): Promise<void> {
    if (createActivity == null) return;
    await createActivity({
      action: ACTION_RECONCILE_REJECTED,
      user: null,
      ip: '0.0.0.0',
      data: { reconcileId, reason, ...data },
    });
  }

  // -------------------------------------------------------------------------
  // submit()
  // -------------------------------------------------------------------------

  async function submit(
    request: ReconcileRequest,
  ): Promise<ReconcileSubmitResult> {
    const { targetType, targetPath, triggeredBy } = request;
    const { userId, isAdmin } = triggeredBy;

    // ------------------------------------------------------------------
    // Step 1: Validate target path syntax via TargetResolver
    // ------------------------------------------------------------------
    const targetResult = targetResolver.resolveTarget(targetType, targetPath);
    if (!targetResult.ok) {
      return { status: 'rejected', reason: 'invalid-target' };
    }
    const baseQuery = targetResult.query;

    // ------------------------------------------------------------------
    // Step 2: Bootstrap state check
    // ------------------------------------------------------------------
    const rejectWhenBootstrapNotDone = configManager.getConfig(
      'app:vaultReconcileRejectWhenBootstrapNotDone',
    );

    if (rejectWhenBootstrapNotDone) {
      const resilienceStatus = await resilienceLayer.getStatus();
      if (resilienceStatus.bootstrap.state !== 'done') {
        return { status: 'rejected', reason: 'bootstrap-not-done' };
      }
    }

    // ------------------------------------------------------------------
    // Step 3: Fetch target page (findOne — no countDocuments)
    // ------------------------------------------------------------------
    const targetPage = await pageModel
      .findOne(
        { path: targetPath },
        { descendantCount: 1, grant: 1, grantedUsers: 1, grantedGroups: 1 },
      )
      .lean();

    if (targetPage == null) {
      return { status: 'rejected', reason: 'invalid-target' };
    }

    const rawDescendantCount = targetPage.descendantCount ?? 0;

    // ------------------------------------------------------------------
    // Step 4: Page count limit check
    // ------------------------------------------------------------------
    const plannedPageCount = targetType === 'page' ? 1 : 1 + rawDescendantCount;

    const roleLimit = isAdmin
      ? configManager.getConfig('app:vaultReconcileMaxPagesPerAdminRequest')
      : configManager.getConfig('app:vaultReconcileMaxPagesPerUserRequest');

    if (plannedPageCount > roleLimit) {
      const rejectReason: ReconcileRejectReason = isAdmin
        ? 'page-count-exceeds-admin-limit'
        : 'page-count-exceeds-user-limit';

      const reconcileId = generateReconcileId();

      // Insert rejected record directly (skip pending since we reject before concurrency check)
      await historyStore.create({
        reconcileId,
        triggeredBy: { userId, isAdmin },
        targetType,
        targetPath,
        descendantCount: rawDescendantCount,
        processedCount: 0,
        status: 'rejected',
        rejectReason,
        triggeredAt: new Date(),
      });

      await emitRejectedAudit(reconcileId, rejectReason, {
        descendantCount: rawDescendantCount,
        roleLimit,
      });

      return {
        status: 'rejected',
        reason: rejectReason,
        descendantCount: rawDescendantCount,
        roleLimit,
      };
    }

    // ------------------------------------------------------------------
    // Step 5: Build ACL-scoped eligible query (no countDocuments)
    // ------------------------------------------------------------------
    // We need a user object for AclEvaluator; build a minimal one from triggeredBy
    const minimalUser = { _id: userId } as Parameters<
      AclEvaluator['buildEligibleQuery']
    >[0]['user'];
    const { eligibleQuery } = await aclEvaluator.buildEligibleQuery({
      user: minimalUser,
      isAdmin,
      baseQuery,
    });

    // ------------------------------------------------------------------
    // Step 6: Insert pending history record
    // ------------------------------------------------------------------
    const reconcileId = generateReconcileId();
    const triggeredAt = new Date();

    await historyStore.create({
      reconcileId,
      triggeredBy: { userId, isAdmin },
      targetType,
      targetPath,
      descendantCount: rawDescendantCount,
      processedCount: 0,
      status: 'pending',
      triggeredAt,
    });

    // ------------------------------------------------------------------
    // Step 7: Try to acquire concurrency slot + schedule background work
    // ------------------------------------------------------------------
    const slotResult = concurrencyController.tryRunInBackground({
      userId,
      isAdmin,
      work: () =>
        orchestrator.run({
          reconcileId,
          eligibleQuery,
          plannedPageCount,
          triggeredBy: { userId, isAdmin },
          targetType,
          targetPath,
        }),
    });

    // ------------------------------------------------------------------
    // Step 8: Handle slot rejection
    // ------------------------------------------------------------------
    if (!slotResult.ok) {
      const rejectReason: ReconcileRejectReason = slotResult.reason;

      await historyStore.updateStatus(reconcileId, {
        status: 'rejected',
        rejectReason,
        completedAt: new Date(),
      });

      await emitRejectedAudit(reconcileId, rejectReason);

      return { status: 'rejected', reason: rejectReason };
    }

    // ------------------------------------------------------------------
    // Step 9: Return accepted
    // ------------------------------------------------------------------
    return {
      status: 'accepted',
      reconcileId,
      descendantCount: rawDescendantCount,
    };
  }

  // -------------------------------------------------------------------------
  // listHistory()
  // -------------------------------------------------------------------------

  function listHistory(opts: {
    limit?: number;
    offset?: number;
  }): Promise<readonly ReconcileLogEntry[]> {
    const limit = opts.limit ?? 20;
    const offset = opts.offset;
    return historyStore.listRecent({ limit, offset });
  }

  // -------------------------------------------------------------------------
  // stop()
  // -------------------------------------------------------------------------

  function stop(): Promise<void> {
    // No background timers or resources to release in this service.
    // Concurrency slots are managed by the controller; orchestrators running
    // in background tasks will complete naturally.
    logger.info('VaultReconcileService: stop() called');
    return Promise.resolve();
  }

  return { submit, listHistory, stop };
}
