import type { VaultInstructionModel } from '~/features/growi-vault/server/models/vault-instruction.js';
import type { VaultSyncStateModel } from '~/features/growi-vault/server/models/vault-sync-state.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:vault:drift-detector');

/**
 * DriftDetector runs a periodic sweep over recently-updated pages and emits
 * bulk-upsert instructions so vault-manager can reconcile any drift that was
 * missed by the real-time change-stream dispatcher.
 *
 * Design principles (§Drift Detector v1 のスコープ縮退, §設計前提: Trash の責務分離):
 *   - NO trash filter — this layer is trash-agnostic. vault-manager applies
 *     isExcludedFromVault() at materialise time.
 *   - NO remove instructions — v1 scope only emits bulk-upsert.
 *   - Hard-delete drift (pages removed from DB) is out of scope for v1.
 *   - Watermark is only advanced on a fully-successful tick; scope-out or
 *     errors leave it unchanged so the next tick retries the same window.
 */

export interface DriftDetector {
  /**
   * Start the periodic drift sweep interval.
   * Safe to call multiple times — a second call replaces the existing interval.
   */
  start(): void;

  /** Stop the interval so no further ticks fire. */
  stop(): void;

  /**
   * Internal: run a single sweep tick.
   * Exposed as a named property so tests can invoke it directly without
   * advancing fake timers.
   *
   * @internal
   */
  _tick(): Promise<void>;
}

export type DriftDetectorDeps = {
  /** Mongoose model for vault_sync_state — injected for testability. */
  vaultSyncState: Pick<VaultSyncStateModel, 'findOne' | 'updateOne'>;

  /** Mongoose model for vault_instructions — write-only from this module. */
  vaultInstruction: Pick<VaultInstructionModel, 'create'>;

  /**
   * Page Mongoose model — read-only query.
   * Typed as `any` to avoid coupling to the Page model's full type definition,
   * which lives outside the growi-vault feature boundary.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageModel: any;

  /** Namespace mapper — pure query, no side effects. */
  namespaceMapper: {
    computePageNamespaces(page: unknown): { current: ReadonlyArray<string> };
  };

  /**
   * Maximum number of pages processed in a single tick.
   * If more pages are found, the tick is aborted (scope-out) and the watermark
   * is NOT advanced.
   *
   * Default: 10_000 (from app:vaultDriftMaxPagesPerTick config).
   */
  maxPagesPerTick: number;

  /**
   * Interval between drift sweep executions in milliseconds.
   * Default: 300_000 (5 minutes, from app:vaultDriftDetectionIntervalMs config).
   */
  intervalMs: number;

  /**
   * Optional audit log writer. When provided, vault.resilience.drift-* events
   * are emitted after each tick. Optional so that tests do not need to wire up
   * the full activityService.
   */
  createActivity?: (data: unknown) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Audit action constants — mirrors activity.ts constants
// ---------------------------------------------------------------------------

const ACTION_DRIFT_SWEEP_STARTED = 'vault.resilience.drift-sweep-started';
const ACTION_DRIFT_DETECTED = 'vault.resilience.drift-detected';
const ACTION_DRIFT_REPAIRED = 'vault.resilience.drift-repaired';
const ACTION_DRIFT_SWEEP_OUT_OF_SCOPE =
  'vault.resilience.drift-sweep-out-of-scope';
const ACTION_DRIFT_SWEEP_FAILED = 'vault.resilience.drift-sweep-failed';

/**
 * Factory that creates a DriftDetector with explicit dependency injection.
 */
export function createDriftDetector(deps: DriftDetectorDeps): DriftDetector {
  const {
    vaultSyncState,
    vaultInstruction,
    pageModel,
    namespaceMapper,
    maxPagesPerTick,
    intervalMs,
    createActivity,
  } = deps;

  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Emit an optional audit activity. Failures are swallowed — audit log write
   * errors must never disrupt the sweep itself.
   */
  async function emitActivity(
    action: string,
    details?: unknown,
  ): Promise<void> {
    if (createActivity == null) return;
    try {
      await createActivity({
        ip: undefined,
        endpoint: 'drift-detector',
        action,
        user: undefined,
        snapshot: {},
        details,
      });
    } catch {
      // Intentionally swallowed — audit failure must not break the sweep.
    }
  }

  async function tick(): Promise<void> {
    // ------------------------------------------------------------------
    // Step 1–2: Read state; skip if not done
    // ------------------------------------------------------------------
    const stateDoc = await vaultSyncState.findOne({ _id: 'singleton' }).lean();
    if (stateDoc == null || stateDoc.bootstrapState !== 'done') {
      return;
    }

    // ------------------------------------------------------------------
    // Step 3: Determine watermark
    // ------------------------------------------------------------------
    const watermark: Date =
      stateDoc.driftLastWatermark ??
      stateDoc.bootstrapCompletedAt ??
      new Date(0);

    await emitActivity(ACTION_DRIFT_SWEEP_STARTED, { watermark });

    // ------------------------------------------------------------------
    // Step 4: Query pages updated after watermark (fetch maxPagesPerTick+1 to
    //         detect scope-out without loading the whole collection)
    // ------------------------------------------------------------------
    let pages: Array<{ _id: unknown; path: string; updatedAt: Date }>;
    try {
      pages = await pageModel
        .find({ updatedAt: { $gt: watermark } })
        .limit(maxPagesPerTick + 1)
        .lean();
    } catch (err) {
      // Query failure: record error, leave watermark unchanged
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ error: errMsg }, 'Drift sweep query failed');
      await vaultSyncState.updateOne(
        { _id: 'singleton' },
        { $set: { driftLastError: `Drift sweep query failed: ${errMsg}` } },
      );
      await emitActivity(ACTION_DRIFT_SWEEP_FAILED, { error: errMsg });
      return;
    }

    // ------------------------------------------------------------------
    // Step 5: Scope-out detection
    // ------------------------------------------------------------------
    if (pages.length > maxPagesPerTick) {
      const scopeOutMsg =
        `Drift sweep aborted: found more than ${maxPagesPerTick} pages updated since watermark ` +
        `(${watermark.toISOString()}). ` +
        'To resolve: (1) increase app:vaultDriftMaxPagesPerTick, or ' +
        '(2) trigger a full re-bootstrap via VAULT_BOOTSTRAP_ON_START=force.';

      logger.warn(scopeOutMsg);

      // Do not update watermark — next tick retries the same window
      await vaultSyncState.updateOne(
        { _id: 'singleton' },
        { $set: { driftLastError: scopeOutMsg } },
      );
      await emitActivity(ACTION_DRIFT_SWEEP_OUT_OF_SCOPE, {
        limit: maxPagesPerTick,
        sampledCount: pages.length,
      });
      return;
    }

    // ------------------------------------------------------------------
    // Step 6: Emit bulk-upsert instructions per page × namespace
    // ------------------------------------------------------------------
    let detectedCount = 0;
    let repairedCount = 0;
    let maxUpdatedAt: Date = watermark;

    for (const page of pages) {
      // Track the high-watermark across all processed pages
      if (page.updatedAt > maxUpdatedAt) {
        maxUpdatedAt = page.updatedAt;
      }

      let namespaces: ReadonlyArray<string>;
      try {
        const result = namespaceMapper.computePageNamespaces(page);
        namespaces = result.current;
      } catch (err) {
        // Mapper error: record and bail out without updating watermark
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { pageId: String(page._id), error: errMsg },
          'Drift sweep namespace mapper failed',
        );
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              driftLastError: `Namespace mapper failed for page ${String(page._id)}: ${errMsg}`,
            },
          },
        );
        await emitActivity(ACTION_DRIFT_SWEEP_FAILED, {
          pageId: String(page._id),
          error: errMsg,
        });
        return;
      }

      detectedCount += 1;

      for (const namespace of namespaces) {
        // Emit bulk-upsert instruction — NO remove instructions (v1 scope)
        await vaultInstruction.create({
          op: 'bulk-upsert',
          payload: {
            namespace,
            entries: [
              {
                pageId: String(page._id),
                pagePath: page.path,
                // revisionId is not available at this layer; use empty string as
                // a sentinel so vault-manager fetches the latest revision.
                revisionId: '',
              },
            ],
          },
        });
        repairedCount += 1;
      }
    }

    // ------------------------------------------------------------------
    // Step 7: Update vault_sync_state (success path)
    // ------------------------------------------------------------------
    const existingDetected = stateDoc.driftDetectedSinceBoot ?? 0;
    const existingRepaired = stateDoc.driftRepairsEmittedSinceBoot ?? 0;

    await vaultSyncState.updateOne(
      { _id: 'singleton' },
      {
        $set: {
          driftLastWatermark:
            pages.length > 0 ? maxUpdatedAt : stateDoc.driftLastWatermark,
          driftLastSweepAt: new Date(),
          driftDetectedSinceBoot: existingDetected + detectedCount,
          driftRepairsEmittedSinceBoot: existingRepaired + repairedCount,
          driftLastError: null,
        },
      },
    );

    // ------------------------------------------------------------------
    // Step 8: Emit audit events
    // ------------------------------------------------------------------
    if (detectedCount > 0) {
      await emitActivity(ACTION_DRIFT_DETECTED, { count: detectedCount });
    }
    if (repairedCount > 0) {
      await emitActivity(ACTION_DRIFT_REPAIRED, { count: repairedCount });
    }
  }

  return {
    start() {
      // Guard against double-start: clear existing interval first.
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
      }
      intervalHandle = setInterval(() => {
        void tick();
      }, intervalMs);
    },

    stop() {
      if (intervalHandle != null) {
        clearInterval(intervalHandle);
        intervalHandle = null;
      }
    },

    _tick: tick,
  };
}
