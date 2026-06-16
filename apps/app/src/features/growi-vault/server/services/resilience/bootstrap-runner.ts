/**
 * BootstrapRunner — central I/O orchestrator for vault bootstrap resilience.
 *
 * Coordinates: state machine, trigger resolver, heartbeat, retry policy.
 * All I/O is performed through injected dependencies (no direct model imports).
 *
 * Requirements: 1.1, 1.2, 1.7, 1.8, 1.10, 1.12, 2.1, 2.2, 2.4, 2.5, 2.6,
 *               3.1, 3.5, 3.6, 3.7, 5.4, 5.7
 */

import loggerFactory from '~/utils/logger';

import type { VaultInstructionModel } from '../../models/vault-instruction';
import type { VaultSyncStateModel } from '../../models/vault-sync-state';
import { createBootstrapHeartbeat } from './bootstrap-heartbeat';
import type { BootstrapState, TriggerSource } from './bootstrap-state-machine';
import { transition } from './bootstrap-state-machine';
import type { BootstrapEnvValue } from './bootstrap-trigger-resolver';
import { resolveAction } from './bootstrap-trigger-resolver';
import type { RetryConfig } from './retry-policy';
import { decideRetry } from './retry-policy';

const logger = loggerFactory(
  'growi:features:growi-vault:service:resilience:bootstrap-runner',
);

// ---------------------------------------------------------------------------
// Audit action constants — mirrors activity.ts ACTION_VAULT_RESILIENCE_* values
// ---------------------------------------------------------------------------

const ACTION_BOOTSTRAP_STARTED = 'vault.resilience.bootstrap-started';
const ACTION_BOOTSTRAP_COMPLETED = 'vault.resilience.bootstrap-completed';
const ACTION_BOOTSTRAP_FAILED = 'vault.resilience.bootstrap-failed';
const ACTION_RETRY_ESCALATED = 'vault.resilience.retry-escalated';
const ACTION_RETRY_ABORTED = 'vault.resilience.retry-aborted';
const ACTION_STALE_RUNNING_DETECTED = 'vault.resilience.stale-running-detected';
const ACTION_FORCE_WARNING_ACTIVE = 'vault.resilience.force-warning-active';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BootstrapStatus {
  readonly state: BootstrapState;
  readonly cursor: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly totalEstimated: number | null;
  readonly processed: number;
  readonly lastError: string | null;
}

export interface RetryStatus {
  readonly attemptNo: number;
  readonly nextAttemptAt: Date | null;
  readonly lastError: string | null;
  readonly aborted: boolean;
}

export interface DriftStatus {
  readonly lastSweepAt: Date | null;
  readonly lastWatermark: Date | null;
  readonly detectedSinceBoot: number;
  readonly repairsEmittedSinceBoot: number;
  readonly lastError: string | null;
}

export interface ResilienceStatus {
  readonly bootstrap: BootstrapStatus;
  readonly retry: RetryStatus | null;
  readonly drift: DriftStatus | null;
  readonly lastTriggerSource: TriggerSource | null;
  readonly forceWarningActive: boolean;
}

export interface VaultResilienceLayer {
  /**
   * Run the bootstrap pipeline.
   *
   * `opts.onRunning` is invoked synchronously after the initial state
   * transition to `'running'` has been committed to MongoDB (and, for
   * forceWipe runs, after the `op: 'reset-all'` instruction has been
   * issued). Callers that need to acknowledge "bootstrap has begun" to
   * a user (e.g. an HTTP request that should return 202 once admin
   * intent is durably recorded) can `await` on the moment this hook
   * fires while the rest of the pipeline continues in the background.
   */
  bootstrap(opts: {
    triggerSource: TriggerSource;
    onRunning?: () => void;
  }): Promise<void>;
  initOnStartup(): Promise<void>;
  getStatus(): Promise<ResilienceStatus>;
  abortAutoRetry(): Promise<void>;
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal page document type used in streaming
// ---------------------------------------------------------------------------

interface StreamedPageDoc {
  _id: { toString(): string };
  path: string | null | undefined;
  revision: { toString(): string } | null | undefined;
}

// ---------------------------------------------------------------------------
// Internal singleton doc fields read by this module
// ---------------------------------------------------------------------------

interface SyncStateFields {
  bootstrapState: BootstrapState;
  bootstrapCursor: { toString(): string } | null;
  bootstrapStartedAt: Date | null;
  bootstrapCompletedAt: Date | null;
  bootstrapTotalEstimated: number | null;
  bootstrapProcessed: number;
  bootstrapLastError: string | null;
  bootstrapInstanceId: string | null;
  bootstrapHeartbeatAt: Date | null;
  bootstrapLastTriggerSource: TriggerSource | null;
  bootstrapRetryAttempts: number;
  bootstrapRetryNextAt: Date | null;
  bootstrapRetryAborted: boolean;
  bootstrapStreamSnapshotMaxId: { toString(): string } | null;
  driftLastWatermark: Date | null;
  driftLastSweepAt: Date | null;
  driftDetectedSinceBoot: number;
  driftRepairsEmittedSinceBoot: number;
  driftLastError: string | null;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface BootstrapRunnerDeps {
  /** VaultSyncState Mongoose model — injected for testability. */
  vaultSyncState: Pick<
    VaultSyncStateModel,
    'findOneAndUpdate' | 'findOne' | 'updateOne'
  >;
  /** VaultInstruction Mongoose model — injected for testability. */
  vaultInstruction: Pick<VaultInstructionModel, 'create' | 'findOne'>;
  /** Page Mongoose model. */
  pageModel: {
    estimatedDocumentCount(): Promise<number>;
    find(query: object): { cursor(): AsyncIterable<StreamedPageDoc> };
    findOne(
      query: object,
      projection?: object | null,
      options?: object | null,
    ): Promise<StreamedPageDoc | null>;
  };
  /** Namespace mapper for ACL-based routing. */
  namespaceMapper: {
    computePageNamespaces(page: StreamedPageDoc): {
      current: readonly string[];
    };
  };
  /** Retry configuration. */
  retryConfig: RetryConfig;
  /** Heartbeat refresh interval in ms. */
  heartbeatIntervalMs: number;
  /** Age in ms beyond which a running heartbeat is considered stale. */
  heartbeatStaleMs: number;
  /** Optional audit log activity factory. */
  createActivity?: (activityData: ActivityData) => Promise<unknown>;
  /**
   * Returns the current value of `VAULT_BOOTSTRAP_ON_START` at status-read time.
   *
   * Called per `getStatus()` so the resulting ResilienceStatus can compare the
   * *current* env value against `bootstrapLastTriggerSource`. The persistent
   * "force still active" banner must only fire when both sides agree (last
   * bootstrap was env-force AND env is still `force`); using only the
   * persisted last-trigger-source produces stale warnings.
   */
  getBootstrapOnStartEnv: () => 'true' | 'false' | 'force';
  /**
   * Override for the completeness verify timeout. Tests use a short value to
   * exercise the timeout-failure path without waiting 5 minutes. Production
   * callers omit this so the module-level default applies.
   */
  verifyTimeoutMsOverride?: number;
}

/**
 * Max time to wait during completeness verification for vault-manager to
 * mark the last emitted instruction as processed (processedAt != null).
 *
 * If the timeout elapses, completeness fails and bootstrap transitions to
 * 'failed' so auto-retry can resume. While we wait, bootstrapState is
 * 'verifying' — the gateway already treats anything other than 'done' as
 * 503, so wipe / bootstrap kill-switch semantics hold for the full duration
 * vault-manager is still catching up.
 *
 * 5 minutes is comfortable headroom for vault-manager to drain instructions
 * for typical workspaces. Hardcoded rather than exposed as a config — if a
 * deployment genuinely needs to extend this, the right answer is usually to
 * fix vault-manager throughput, not to raise the timeout.
 */
const VERIFY_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Polling interval for the completeness verify wait loop.
 *
 * 500ms is a balance between responsiveness (state flips to 'done' soon after
 * vault-manager processes the last instruction) and DB load (one findOne per
 * poll).
 */
const VERIFY_POLL_INTERVAL_MS = 500;

interface ActivityData {
  action: string;
  user: null;
  ip: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Reads the singleton doc and returns it (or null if not found). */
async function readSingleton(
  vss: BootstrapRunnerDeps['vaultSyncState'],
): Promise<(SyncStateFields & { _id: string }) | null> {
  const doc = await vss.findOne({ _id: 'singleton' }).lean();
  return doc as (SyncStateFields & { _id: string }) | null;
}

interface BulkUpsertEntry {
  pageId: string;
  pagePath: string;
  revisionId: string;
}

/** Flush accumulated namespace buffers as bulk-upsert instructions. */
async function flushBuffers(
  buffers: Map<string, BulkUpsertEntry[]>,
  vaultInstruction: BootstrapRunnerDeps['vaultInstruction'],
): Promise<{ lastInstructionId: { toString(): string } | null }> {
  let lastId: { toString(): string } | null = null;
  const flushEntries = [...buffers.entries()].filter(
    ([, entries]) => entries.length > 0,
  );

  for (const [namespace, entries] of flushEntries) {
    // Sequential flush preserves ordering of instructions
    // biome-ignore lint/performance/noAwaitInLoops: sequential flush preserves instruction order
    const doc = await vaultInstruction.create({
      op: 'bulk-upsert',
      payload: { namespace, entries },
      issuedAt: new Date(),
    });
    lastId = (doc as { _id: { toString(): string } })._id;
    buffers.set(namespace, []);
  }
  return { lastInstructionId: lastId };
}

/** Map TriggerSource to BootstrapEnvValue for the resolver. */
function triggerSourceToEnvValue(src: TriggerSource): BootstrapEnvValue {
  if (src === 'env-force') return 'force';
  if (src === 'env-true') return 'true';
  // admin-force-wipe behaves like forceOverride
  return 'force';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBootstrapRunner(
  deps: BootstrapRunnerDeps,
): VaultResilienceLayer {
  const {
    vaultSyncState,
    vaultInstruction,
    pageModel,
    namespaceMapper,
    retryConfig,
    heartbeatIntervalMs,
    heartbeatStaleMs,
    createActivity,
    getBootstrapOnStartEnv,
    verifyTimeoutMsOverride,
  } = deps;

  const verifyTimeoutMs = verifyTimeoutMsOverride ?? VERIFY_TIMEOUT_MS;

  const heartbeat = createBootstrapHeartbeat({
    // heartbeat only needs updateOne / findOne — cast to satisfy its narrower Pick type
    vaultSyncState: vaultSyncState as Parameters<
      typeof createBootstrapHeartbeat
    >[0]['vaultSyncState'],
    intervalMs: heartbeatIntervalMs,
    staleThresholdMs: heartbeatStaleMs,
  });

  // -------------------------------------------------------------------------
  // Completeness check — 3 conditions must all pass (AND)
  // -------------------------------------------------------------------------

  interface CompletenessResult {
    ok: boolean;
    reason: string | null;
  }

  async function checkCompleteness(opts: {
    lastInstructionId: { toString(): string } | null;
    finalCursor: { toString(): string } | null;
    streamSnapshotMaxId: { toString(): string } | null;
    namespaceBuffersEmpty: boolean;
  }): Promise<CompletenessResult> {
    const {
      lastInstructionId,
      finalCursor,
      streamSnapshotMaxId,
      namespaceBuffersEmpty,
    } = opts;

    // Condition (ii): namespace buffers must be fully flushed
    if (!namespaceBuffersEmpty) {
      return {
        ok: false,
        reason:
          'Completeness check failed: namespace buffers not fully flushed',
      };
    }

    // Condition (i): cursor must have reached streamSnapshotMaxId
    if (streamSnapshotMaxId != null) {
      const snapshotStr = streamSnapshotMaxId.toString();
      const cursorStr = finalCursor?.toString() ?? null;
      if (cursorStr !== snapshotStr) {
        return {
          ok: false,
          reason:
            'Completeness check failed: cursor did not reach streamSnapshotMaxId',
        };
      }
    }

    // No instructions emitted → empty DB, treat as OK
    if (lastInstructionId == null) {
      return { ok: true, reason: null };
    }

    // Condition (iii): vault-manager has acknowledged processing of the last
    // emitted instruction (processedAt != null). Poll until processed or until
    // the verify timeout elapses — bootstrapState stays 'verifying' the whole
    // time so the gateway keeps returning 503 while we wait.
    //
    // We poll rather than block on a change stream because the runner is
    // intentionally lightweight; vault-manager normally processes within a few
    // hundred ms but the timeout (default 5 min) tolerates slow or stuck
    // processors and lets auto-retry handle persistent failures.
    const deadline = Date.now() + verifyTimeoutMs;
    while (true) {
      const committed = await vaultInstruction.findOne({
        _id: lastInstructionId,
      });
      if (committed == null) {
        return {
          ok: false,
          reason: 'Completeness check failed: last instruction not committed',
        };
      }
      if (committed.processedAt != null) {
        return { ok: true, reason: null };
      }
      if (Date.now() >= deadline) {
        return {
          ok: false,
          reason:
            'Completeness check failed: vault-manager did not process last instruction within timeout',
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, VERIFY_POLL_INTERVAL_MS),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Core bootstrap execution
  // -------------------------------------------------------------------------

  async function executeBootstrap(opts: {
    triggerSource: TriggerSource;
    forceWipe: boolean;
    isStaleResume: boolean;
    currentRetryAttempts: number;
    onRunning?: () => void;
  }): Promise<void> {
    const {
      triggerSource,
      forceWipe,
      isStaleResume,
      currentRetryAttempts,
      onRunning,
    } = opts;

    // --- Step 1: Acquire heartbeat instance ID
    await heartbeat.acquireInstance();

    // --- Step 2: Transition state → running (multi-step for resume paths)
    {
      const current = await readSingleton(vaultSyncState);
      const currentState: BootstrapState = current?.bootstrapState ?? 'pending';

      let emitResetAll = false;

      if (forceWipe) {
        // forceOverride: single transition from ANY state → running
        const result = transition(currentState, { type: 'forceOverride' });
        if (!result.ok) {
          logger.warn(
            { reason: result.reason },
            'Bootstrap forceOverride rejected',
          );
          return;
        }
        for (const se of result.sideEffects) {
          if (se.kind === 'emitResetAll') emitResetAll = true;
        }

        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: result.next,
              bootstrapStartedAt: new Date(),
              bootstrapProcessed: 0,
              bootstrapCompletedAt: null,
              bootstrapLastError: null,
              bootstrapLastTriggerSource: triggerSource,
              bootstrapRetryAttempts: currentRetryAttempts,
            },
          },
          { upsert: true },
        );
      } else if (isStaleResume && currentState === 'running') {
        // Stale running: running → staleRunningDetected → retrying → start → running
        await createActivity?.({
          action: ACTION_STALE_RUNNING_DETECTED,
          user: null,
          ip: '127.0.0.1',
        });
        const toRetrying = transition(currentState, {
          type: 'staleRunningDetected',
        });
        if (!toRetrying.ok) {
          logger.warn(
            { reason: toRetrying.reason },
            'Stale-resume transition rejected',
          );
          return;
        }
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          { $set: { bootstrapState: toRetrying.next } },
        );

        const toRunning = transition(toRetrying.next, {
          type: 'start',
          triggerSource,
        });
        if (!toRunning.ok) {
          logger.warn(
            { reason: toRunning.reason },
            'Stale-resume start rejected',
          );
          return;
        }
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: toRunning.next,
              bootstrapStartedAt: new Date(),
              bootstrapProcessed: 0,
              bootstrapLastTriggerSource: triggerSource,
              bootstrapRetryAttempts: currentRetryAttempts,
            },
          },
        );
      } else if (currentState === 'failed' || currentState === 'retrying') {
        // Resume from failed/retrying:
        //   failed → retryScheduled → retrying → start → running
        const retryDecision = decideRetry(retryConfig, currentRetryAttempts);

        let stateBeforeStart: BootstrapState = currentState;
        if (currentState === 'failed') {
          const toRetrying = transition(currentState, {
            type: 'retryScheduled',
            attemptNo: retryDecision.attemptNo,
          });
          if (!toRetrying.ok) {
            logger.warn(
              { reason: toRetrying.reason },
              'Retry transition rejected',
            );
            return;
          }
          stateBeforeStart = toRetrying.next;
          await vaultSyncState.updateOne(
            { _id: 'singleton' },
            { $set: { bootstrapState: stateBeforeStart } },
          );
        }

        const toRunning = transition(stateBeforeStart, {
          type: 'start',
          triggerSource,
        });
        if (!toRunning.ok) {
          logger.warn({ reason: toRunning.reason }, 'Resume start rejected');
          return;
        }
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: toRunning.next,
              bootstrapStartedAt: new Date(),
              bootstrapProcessed: 0,
              bootstrapLastError: null,
              bootstrapLastTriggerSource: triggerSource,
              bootstrapRetryAttempts: retryDecision.attemptNo,
            },
          },
        );
      } else {
        // Standard start: pending → start → running
        const result = transition(currentState, {
          type: 'start',
          triggerSource,
        });
        if (!result.ok) {
          logger.warn(
            { reason: result.reason },
            'Bootstrap transition rejected',
          );
          return;
        }
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: result.next,
              bootstrapStartedAt: new Date(),
              bootstrapProcessed: 0,
              bootstrapCompletedAt: null,
              bootstrapLastError: null,
              bootstrapLastTriggerSource: triggerSource,
              bootstrapRetryAttempts: currentRetryAttempts,
            },
          },
          { upsert: true },
        );
      }

      if (emitResetAll) {
        await vaultInstruction.create({
          op: 'reset-all',
          payload: {},
          issuedAt: new Date(),
        });
        await createActivity?.({
          action: ACTION_FORCE_WARNING_ACTIVE,
          user: null,
          ip: '127.0.0.1',
        });
      }
    }

    // Signal the synchronous handshake point. State is now 'running' in the
    // DB, the reset-all instruction (if applicable) has been queued for
    // vault-manager, and the audit trail has captured the destructive intent.
    // Callers awaiting `onRunning` (typically an HTTP route returning 202)
    // can now respond — subsequent work continues in the background but the
    // gateway already returns 503 for any client clone, so no inconsistent
    // state is observable.
    onRunning?.();

    await createActivity?.({
      action: ACTION_BOOTSTRAP_STARTED,
      user: null,
      ip: '127.0.0.1',
      data: { triggerSource, forceWipe },
    });

    // --- Step 3: Estimate total pages
    const totalEstimated = await pageModel.estimatedDocumentCount();
    await vaultSyncState.updateOne(
      { _id: 'singleton' },
      { $set: { bootstrapTotalEstimated: totalEstimated } },
    );

    // --- Step 4: Record snapshot max ID for completeness check
    // Find the page with the highest _id at snapshot time (no trash filter — layering principle).
    const snapshotMaxPage = await pageModel.findOne({}, null, {
      sort: { _id: -1 },
    });
    const snapshotMaxId = snapshotMaxPage?._id ?? null;
    if (snapshotMaxId != null) {
      await vaultSyncState.updateOne(
        { _id: 'singleton' },
        { $set: { bootstrapStreamSnapshotMaxId: snapshotMaxId } },
      );
    }

    // --- Step 5: Start heartbeat refresh
    heartbeat.refresh();

    try {
      // --- Step 6: Stream pages and accumulate per-namespace buffers
      const doc = await readSingleton(vaultSyncState);
      const resumeCursor = forceWipe ? null : (doc?.bootstrapCursor ?? null);

      // No trash/status filter — layering principle: vault-manager's isExcludedFromVault handles exclusion.
      const query: Record<string, unknown> = {};
      if (resumeCursor != null) {
        query._id = { $gt: resumeCursor };
      }

      const CHUNK_SIZE = 1000;
      const namespaceBuffers = new Map<string, BulkUpsertEntry[]>();
      let processed = 0;
      let lastInstructionId: { toString(): string } | null = null;
      let finalCursor: { toString(): string } | null = null;

      const cursor = pageModel.find(query).cursor();

      for await (const page of cursor) {
        processed += 1;

        // Skip pages without revision (intermediate path pages)
        if (page.revision == null) {
          finalCursor = page._id;
          await vaultSyncState.updateOne(
            { _id: 'singleton' },
            {
              $set: {
                bootstrapCursor: page._id,
                bootstrapProcessed: processed,
              },
            },
          );
          continue;
        }

        const { current: namespaces } =
          namespaceMapper.computePageNamespaces(page);

        for (const ns of namespaces) {
          if (!namespaceBuffers.has(ns)) {
            namespaceBuffers.set(ns, []);
          }
          const buf = namespaceBuffers.get(ns) ?? [];
          buf.push({
            pageId: page._id.toString(),
            pagePath: page.path ?? '',
            revisionId: page.revision.toString(),
          });
          namespaceBuffers.set(ns, buf);

          if (buf.length >= CHUNK_SIZE) {
            // biome-ignore lint/performance/noAwaitInLoops: sequential flush preserves instruction order
            const docCreated = await vaultInstruction.create({
              op: 'bulk-upsert',
              payload: { namespace: ns, entries: buf },
              issuedAt: new Date(),
            });
            lastInstructionId = (docCreated as { _id: { toString(): string } })
              ._id;
            namespaceBuffers.set(ns, []);
          }
        }

        finalCursor = page._id;
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapCursor: page._id,
              bootstrapProcessed: processed,
            },
          },
        );
      }

      // --- Step 7: Flush remaining buffers
      const { lastInstructionId: flushedId } = await flushBuffers(
        namespaceBuffers,
        vaultInstruction,
      );
      if (flushedId != null) {
        lastInstructionId = flushedId;
      }

      // --- Step 8: Transition to verifying
      await vaultSyncState.updateOne(
        { _id: 'singleton' },
        {
          $set: {
            bootstrapState: 'verifying',
            bootstrapCompletenessLastCheckedAt: new Date(),
          },
        },
      );

      // --- Step 9: Completeness check (3 conditions AND)
      const namespaceBuffersEmpty = [...namespaceBuffers.values()].every(
        (buf) => buf.length === 0,
      );
      const completeness = await checkCompleteness({
        lastInstructionId,
        finalCursor,
        streamSnapshotMaxId: snapshotMaxId as { toString(): string } | null,
        namespaceBuffersEmpty,
      });

      if (completeness.ok) {
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: 'done',
              bootstrapCompletedAt: new Date(),
              bootstrapCursor: null,
              bootstrapCompletenessLastResult: 'ok',
              bootstrapRetryAttempts: 0,
              bootstrapRetryNextAt: null,
              bootstrapRetryAborted: false,
            },
          },
        );

        logger.info({ processed }, 'Bootstrap completed successfully');

        await createActivity?.({
          action: ACTION_BOOTSTRAP_COMPLETED,
          user: null,
          ip: '127.0.0.1',
        });
      } else {
        const failReason = completeness.reason ?? 'Completeness check failed';
        await vaultSyncState.updateOne(
          { _id: 'singleton' },
          {
            $set: {
              bootstrapState: 'failed',
              bootstrapLastError: failReason,
              bootstrapCompletenessLastResult: 'failed',
            },
          },
        );

        logger.error({ failReason }, 'Bootstrap completeness check failed');

        await createActivity?.({
          action: ACTION_BOOTSTRAP_FAILED,
          user: null,
          ip: '127.0.0.1',
        });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({ error }, 'Bootstrap threw an error');

      await vaultSyncState.updateOne(
        { _id: 'singleton' },
        {
          $set: { bootstrapState: 'failed', bootstrapLastError: errorMessage },
        },
      );

      await createActivity?.({
        action: ACTION_BOOTSTRAP_FAILED,
        user: null,
        ip: '127.0.0.1',
        data: { error: errorMessage },
      });
    } finally {
      heartbeat.stop();
    }
  }

  // -------------------------------------------------------------------------
  // Public interface
  // -------------------------------------------------------------------------

  return {
    async bootstrap(opts: {
      triggerSource: TriggerSource;
      onRunning?: () => void;
    }): Promise<void> {
      const { triggerSource, onRunning } = opts;

      // Read current persisted state
      const doc = await readSingleton(vaultSyncState);
      const currentState: BootstrapState = doc?.bootstrapState ?? 'pending';
      const retryAttempts: number = doc?.bootstrapRetryAttempts ?? 0;
      const retryAborted: boolean = doc?.bootstrapRetryAborted ?? false;

      // Detect stale running
      const isStale = await heartbeat.detectStaleRunning();

      // Determine env value from trigger source
      const envValue = triggerSourceToEnvValue(triggerSource);

      // retryAllowed: retry budget not exhausted and not manually aborted
      const retryAllowed =
        !retryAborted && retryAttempts < retryConfig.maxAttempts;

      // Resolve the action
      const action = resolveAction(
        envValue,
        currentState,
        retryAllowed,
        isStale,
      );

      logger.info(
        { action: action.kind, currentState, triggerSource },
        'Bootstrap trigger resolved',
      );

      if (action.kind === 'skip') {
        // When retry budget is exhausted (not operator-aborted), escalate from failed/retrying.
        // retryAllowed=false covers both aborted and exhausted cases; disambiguate here.
        const isRetryBudgetExhausted =
          !retryAborted && !decideRetry(retryConfig, retryAttempts).shouldRetry;
        if (
          isRetryBudgetExhausted &&
          (currentState === 'failed' || currentState === 'retrying')
        ) {
          // failed → retrying is required before retryExhausted is a valid transition
          let stateBeforeEscalate: BootstrapState = currentState;
          if (currentState === 'failed') {
            const toRetrying = transition(currentState, {
              type: 'retryScheduled',
              attemptNo: retryAttempts,
            });
            if (!toRetrying.ok) {
              logger.warn(
                { reason: toRetrying.reason },
                'Escalation: retryScheduled rejected',
              );
              return;
            }
            stateBeforeEscalate = toRetrying.next;
          }
          const toEscalated = transition(stateBeforeEscalate, {
            type: 'retryExhausted',
          });
          if (toEscalated.ok) {
            await vaultSyncState.updateOne(
              { _id: 'singleton' },
              { $set: { bootstrapState: toEscalated.next } },
            );
            logger.warn(
              { retryAttempts },
              'Bootstrap retry budget exhausted — escalating',
            );
            await createActivity?.({
              action: ACTION_RETRY_ESCALATED,
              user: null,
              ip: '127.0.0.1',
              data: { retryAttempts },
            });
          }
        }
        return;
      }

      const forceWipe = action.kind === 'forceWipe';
      const isStaleResume = action.kind === 'resumeFromCursor' && isStale;

      await executeBootstrap({
        triggerSource: action.triggerSource as TriggerSource,
        forceWipe,
        isStaleResume,
        currentRetryAttempts: retryAttempts,
        onRunning,
      });
    },

    async initOnStartup(): Promise<void> {
      const doc = await readSingleton(vaultSyncState);
      if (doc == null) {
        await vaultSyncState.findOneAndUpdate(
          { _id: 'singleton' },
          {
            $setOnInsert: { bootstrapState: 'pending', bootstrapProcessed: 0 },
          },
          { upsert: true, new: true } as Parameters<
            VaultSyncStateModel['findOneAndUpdate']
          >[2],
        );
      }

      await this.bootstrap({ triggerSource: 'env-true' });
    },

    async getStatus(): Promise<ResilienceStatus> {
      const doc = await readSingleton(vaultSyncState);

      if (doc == null) {
        return {
          bootstrap: {
            state: 'pending',
            cursor: null,
            startedAt: null,
            completedAt: null,
            totalEstimated: null,
            processed: 0,
            lastError: null,
          },
          retry: null,
          drift: null,
          lastTriggerSource: null,
          forceWarningActive: false,
        };
      }

      const bootstrap: BootstrapStatus = {
        state: doc.bootstrapState,
        cursor: doc.bootstrapCursor?.toString() ?? null,
        startedAt: doc.bootstrapStartedAt,
        completedAt: doc.bootstrapCompletedAt,
        totalEstimated: doc.bootstrapTotalEstimated,
        processed: doc.bootstrapProcessed,
        lastError: doc.bootstrapLastError,
      };

      // RetryStatus: expose when retry attempts > 0 or state indicates retry
      const hasRetryInfo =
        doc.bootstrapRetryAttempts > 0 ||
        doc.bootstrapRetryNextAt != null ||
        doc.bootstrapState === 'retrying' ||
        doc.bootstrapState === 'escalated';

      const retry: RetryStatus | null = hasRetryInfo
        ? {
            attemptNo: doc.bootstrapRetryAttempts,
            nextAttemptAt: doc.bootstrapRetryNextAt,
            lastError: doc.bootstrapLastError,
            aborted: doc.bootstrapRetryAborted,
          }
        : null;

      // DriftStatus: expose when drift sweep has run
      const hasDriftInfo =
        doc.driftLastSweepAt != null || doc.driftDetectedSinceBoot > 0;
      const drift: DriftStatus | null = hasDriftInfo
        ? {
            lastSweepAt: doc.driftLastSweepAt,
            lastWatermark: doc.driftLastWatermark,
            detectedSinceBoot: doc.driftDetectedSinceBoot,
            repairsEmittedSinceBoot: doc.driftRepairsEmittedSinceBoot,
            lastError: doc.driftLastError,
          }
        : null;

      const lastTriggerSource = doc.bootstrapLastTriggerSource;
      // forceWarningActive: only true when BOTH the last bootstrap was env-force
      // AND VAULT_BOOTSTRAP_ON_START is still 'force'. Banner copy reads
      // "Restarting while this env var is still set to `force` will wipe...",
      // so the warning is meaningful only while both sides remain true.
      const forceWarningActive =
        lastTriggerSource === 'env-force' &&
        getBootstrapOnStartEnv() === 'force';

      return {
        bootstrap,
        retry,
        drift,
        lastTriggerSource,
        forceWarningActive,
      };
    },

    async abortAutoRetry(): Promise<void> {
      const doc = await readSingleton(vaultSyncState);
      const currentState: BootstrapState = doc?.bootstrapState ?? 'pending';

      const updates: Record<string, unknown> = {
        bootstrapRetryAttempts: 0,
        bootstrapRetryAborted: true,
        bootstrapRetryNextAt: null,
      };

      // Downgrade escalated → failed so operators can inspect
      if (currentState === 'escalated') {
        updates.bootstrapState = 'failed';
      }

      await vaultSyncState.updateOne({ _id: 'singleton' }, { $set: updates });

      logger.info('Auto-retry aborted by operator');

      await createActivity?.({
        action: ACTION_RETRY_ABORTED,
        user: null,
        ip: '127.0.0.1',
      });
    },

    stop(): Promise<void> {
      heartbeat.stop();
      return Promise.resolve();
    },
  };
}
