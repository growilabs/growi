import type { IPage } from '@growi/core';
import type { Router } from 'express';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { VaultInstruction } from './models/vault-instruction';
import { VaultReconcileLog } from './models/vault-reconcile-log';
import { VaultSyncState } from './models/vault-sync-state';
import { createVaultAdminRouter } from './routes/vault-admin';
import { createVaultGatewayRouter } from './routes/vault-gateway';
import { createVaultPageRouter } from './routes/vault-page';
import {
  createVaultReconcileService,
  type VaultReconcileService,
} from './services/reconcile';
import { createHistoryStore } from './services/reconcile/reconcile-history-store';
import { createVaultBootstrapper } from './services/vault-bootstrapper';
import { createVaultDispatcher } from './services/vault-dispatcher';
import { vaultNamespaceMapper } from './services/vault-namespace-mapper';
import { vaultSettingsService } from './services/vault-settings-service';

export { createVaultAdminRouter } from './routes/vault-admin';
export { createVaultGatewayRouter } from './routes/vault-gateway';

// ---------------------------------------------------------------------------
// Module-level reconcile service singleton (set during initializeVaultFeature)
// ---------------------------------------------------------------------------

/** Module-level singleton set by initializeVaultFeature(). */
let _reconcileService: VaultReconcileService | undefined;

// ---------------------------------------------------------------------------
// Crowi-bound router factories
// ---------------------------------------------------------------------------

/**
 * Create the VaultGatewayRouter wired to the given Crowi instance.
 *
 * Extracts the activityService.createActivity method from Crowi and passes it
 * to the router so that audit-log events are written without the router needing
 * to depend on the full Crowi object directly.
 *
 * @param crowi - The Crowi application instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createVaultGatewayRouterWithDeps = (crowi: any): Router => {
  const createActivity =
    crowi.activityService != null
      ? crowi.activityService.createActivity.bind(crowi.activityService)
      : undefined;

  return createVaultGatewayRouter({ createActivity });
};

/**
 * Create the VaultAdminRouter wired to the given Crowi instance.
 *
 * Passes the Crowi instance so that the router can build its loginRequired and
 * adminRequired middleware, and reuses the default VaultBootstrapper singleton
 * (wired to the production VaultNamespaceMapper).
 *
 * @param crowi - The Crowi application instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createVaultAdminRouterWithDeps = (crowi: any): Router => {
  const bootstrapper = createVaultBootstrapper(vaultNamespaceMapper);
  return createVaultAdminRouter({
    crowi,
    bootstrapper,
    reconcileService: _reconcileService,
  });
};

/**
 * Create the VaultPageRouter wired to the given Crowi instance.
 *
 * Passes the module-level reconcileService singleton (set by
 * initializeVaultFeature) so the router can accept user-triggered reconcile
 * requests. When called before initializeVaultFeature the reconcileService
 * will be undefined and the endpoint returns 500 (graceful degradation).
 *
 * @param crowi - The Crowi application instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const createVaultPageRouterWithDeps = (crowi: any): Router => {
  return createVaultPageRouter({ crowi, reconcileService: _reconcileService });
};

const logger = loggerFactory('growi:features:growi-vault:server');

// ---------------------------------------------------------------------------
// Resilience layer: startup migration
// ---------------------------------------------------------------------------

/**
 * Run the vault_sync_state startup migration.
 *
 * Idempotent — safe to call on every boot regardless of DB state.
 *
 * Step 1: Ensure the singleton document exists (handles fresh installs).
 *         Uses $setOnInsert so existing documents are never overwritten.
 *
 * Step 2: Back-fill the 14 new resilience fields on pre-migration documents.
 *         The filter `bootstrapRetryAttempts: { $exists: false }` is a
 *         one-time predicate — once migrated the update becomes a no-op.
 *         No upsert option to prevent E11000 on concurrent runs.
 *
 * Step 3: Normalize a stale 'running' state that has no instanceId.
 *         A running document without an instanceId means the previous process
 *         crashed before the resilience schema was applied; mark it 'failed'
 *         so the bootstrapper can decide whether to retry.
 *
 * Requirements: 1.11, 3.3
 */
export const runVaultSyncStateMigration = async (): Promise<void> => {
  // Step 1: ensure singleton exists (fresh install)
  await VaultSyncState.findOneAndUpdate(
    { _id: 'singleton' },
    {
      $setOnInsert: {
        bootstrapState: 'pending',
        bootstrapCursor: null,
        bootstrapStartedAt: null,
        bootstrapCompletedAt: null,
        bootstrapTotalEstimated: null,
        bootstrapProcessed: 0,
        bootstrapLastError: null,
        bootstrapInstanceId: null,
        bootstrapHeartbeatAt: null,
        bootstrapLastTriggerSource: null,
        bootstrapRetryAttempts: 0,
        bootstrapRetryNextAt: null,
        bootstrapRetryAborted: false,
        bootstrapCompletenessLastCheckedAt: null,
        bootstrapCompletenessLastResult: null,
        bootstrapStreamSnapshotMaxId: null,
        resumeToken: null,
        lastProcessedAt: null,
        watcherInstanceId: null,
        driftLastWatermark: null,
        driftLastSweepAt: null,
        driftDetectedSinceBoot: 0,
        driftRepairsEmittedSinceBoot: 0,
        driftLastError: null,
      },
    },
    { upsert: true, new: false },
  );

  // Step 2: back-fill resilience fields on existing pre-migration documents.
  // No upsert — prevents E11000 on concurrent boots.
  await VaultSyncState.updateOne(
    { _id: 'singleton', bootstrapRetryAttempts: { $exists: false } },
    {
      $set: {
        bootstrapInstanceId: null,
        bootstrapHeartbeatAt: null,
        bootstrapLastTriggerSource: null,
        bootstrapRetryAttempts: 0,
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
      },
    },
  );

  // Step 3: normalize stale 'running' with no instanceId to 'failed'.
  const doc = await VaultSyncState.findOne({ _id: 'singleton' }).lean();
  if (doc?.bootstrapState === 'running' && doc?.bootstrapInstanceId == null) {
    await VaultSyncState.updateOne(
      { _id: 'singleton' },
      {
        $set: {
          bootstrapState: 'failed',
          bootstrapLastError:
            'normalized stale running on first startup after schema migration',
        },
      },
    );
  }
};

// ---------------------------------------------------------------------------
// Vault feature initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the GROWI Vault feature.
 *
 * This function:
 *  1. Reads the vaultEnabled flag and, if enabled, subscribes VaultDispatcher
 *     to PageService events (create / update / delete / syncDescendantsUpdate /
 *     syncDescendantsDelete).
 *  2. Creates a VaultBootstrapper instance and, when the environment variable
 *     VAULT_BOOTSTRAP_ON_START=true is set, starts a bootstrap run immediately.
 *
 * Must be called after Crowi.init() so that crowi.events.page is ready.
 *
 * @param crowi - The Crowi application instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const initializeVaultFeature = async (crowi: any): Promise<void> => {
  // ------------------------------------------------------------------
  // Step 1: Subscribe VaultDispatcher to PageService events
  // ------------------------------------------------------------------
  let settings: Awaited<ReturnType<typeof vaultSettingsService.getSettings>>;
  try {
    settings = await vaultSettingsService.getSettings();
  } catch (err) {
    logger.error(
      { err },
      'Failed to read vault settings; skipping vault initialization',
    );
    return;
  }

  if (settings.enabled) {
    const dispatcher = createVaultDispatcher(vaultNamespaceMapper);
    const pageEvent = crowi.events.page;

    // Subscribe to single-page lifecycle events.
    pageEvent.on(
      'create',
      (page: IPage & { _id: { toString(): string } }, _user: unknown) => {
        // Resolve revisionId from the populated page object.
        // page.revision may be an ObjectId or a populated Revision document.
        const revisionId =
          page.revision != null
            ? typeof page.revision === 'object' && '_id' in page.revision
              ? (
                  page.revision as { _id: { toString(): string } }
                )._id.toString()
              : page.revision.toString()
            : undefined;

        dispatcher
          .onPageChanged({ type: 'create', page, revisionId })
          .catch((err) => {
            logger.warn(
              { err },
              'vault-dispatcher: error handling create event',
            );
          });
      },
    );

    pageEvent.on(
      'update',
      (page: IPage & { _id: { toString(): string } }, _user: unknown) => {
        const revisionId =
          page.revision != null
            ? typeof page.revision === 'object' && '_id' in page.revision
              ? (
                  page.revision as { _id: { toString(): string } }
                )._id.toString()
              : page.revision.toString()
            : undefined;

        dispatcher
          .onPageChanged({ type: 'update', page, revisionId })
          .catch((err) => {
            logger.warn(
              { err },
              'vault-dispatcher: error handling update event',
            );
          });
      },
    );

    pageEvent.on(
      'delete',
      (
        page: IPage & { _id: { toString(): string } },
        _deletedPage: unknown,
        _user: unknown,
      ) => {
        // The first argument is the pre-deletion page state (contains the original path).
        dispatcher.onPageChanged({ type: 'delete', page }).catch((err) => {
          logger.warn({ err }, 'vault-dispatcher: error handling delete event');
        });
      },
    );

    // ------------------------------------------------------------------
    // Stage 2 (task 21.1-B) — rename / grant-change-prefix propagation
    // ------------------------------------------------------------------
    //
    // 'rename' (single page): GROWI core was extended to carry
    //   { page, oldPath, newPath, user }. A page's own path is stored in the
    //   namespace tree as a blob (`<name>.md`), not a directory, so a
    //   rename-prefix (subtree move) cannot relocate it. We model the rename
    //   as remove(oldPath) + upsert(newPath) via onPageRenamed instead.
    //   Descendant relocation is handled separately by the 'updateMany'
    //   subscriber's rename-prefix path.
    pageEvent.on(
      'rename',
      (payload?: {
        page?: IPage & { _id: { toString(): string }; revision?: unknown };
        oldPath?: string;
        newPath?: string;
        user?: unknown;
      }) => {
        if (
          payload == null ||
          payload.page == null ||
          payload.oldPath == null ||
          payload.newPath == null
        ) {
          logger.debug(
            'vault-dispatcher: skipping rename without { page, oldPath, newPath } payload',
          );
          return;
        }
        const { page } = payload;
        const revisionId =
          page.revision != null
            ? typeof page.revision === 'object' && '_id' in page.revision
              ? (
                  page.revision as { _id: { toString(): string } }
                )._id.toString()
              : (page.revision as { toString(): string }).toString()
            : undefined;
        dispatcher
          .onPageRenamed({
            page,
            oldPath: payload.oldPath,
            newPath: payload.newPath,
            revisionId,
          })
          .catch((err) => {
            logger.warn(
              { err },
              'vault-dispatcher: error handling rename event',
            );
          });
      },
    );

    // 'updateMany' (bulk rename of descendants): GROWI core was extended to
    // carry a 4th argument { oldPagePathPrefix, newPagePathPrefix }. When
    // present, we emit a single rename-prefix instruction per affected
    // namespace — that collapses N descendant updates into M (= namespace
    // count) instructions. When absent (legacy callers / non-rename emits),
    // we fall back to per-page upserts so behaviour is at least correct, if
    // less efficient.
    //
    // Coalesce safety: dispatcher.onPageChanged() coalesces high-frequency
    // upserts on the same namespace into bulk-upsert instructions, so the
    // fallback path is safe at scale.
    pageEvent.on(
      'updateMany',
      (
        pages: Array<
          IPage & {
            _id: { toString(): string };
            revision?: unknown;
          }
        >,
        _user: unknown,
        extras?: { oldPagePathPrefix?: string; newPagePathPrefix?: string },
      ) => {
        if (!Array.isArray(pages) || pages.length === 0) return;

        // Stage 2 fast path: GROWI core sent us prefix info → rename-prefix.
        if (
          extras?.oldPagePathPrefix != null &&
          extras?.newPagePathPrefix != null
        ) {
          // The namespaces a bulk rename affects are the union of the
          // namespaces of every descendant page. Grant is unchanged by a
          // rename, so we can read it off the (unchanged) in-memory pages.
          const namespaceSet = new Set<string>();
          for (const page of pages) {
            const { current } =
              vaultNamespaceMapper.computePageNamespaces(page);
            for (const ns of current) namespaceSet.add(ns);
          }
          if (namespaceSet.size === 0) return;
          dispatcher
            .onBulkOperation({
              type: 'rename-prefix',
              namespaces: Array.from(namespaceSet),
              oldPrefix: extras.oldPagePathPrefix,
              newPrefix: extras.newPagePathPrefix,
            })
            .catch((err) => {
              logger.warn(
                { err },
                'vault-dispatcher: error handling updateMany (rename-prefix)',
              );
            });
          return;
        }

        // Fallback: per-page upsert.
        for (const page of pages) {
          if (page.revision == null) continue;
          const revisionId =
            typeof page.revision === 'object' && '_id' in page.revision
              ? (
                  page.revision as { _id: { toString(): string } }
                )._id.toString()
              : (page.revision as { toString(): string }).toString();
          dispatcher
            .onPageChanged({ type: 'update', page, revisionId })
            .catch((err) => {
              logger.warn(
                { err },
                'vault-dispatcher: error handling updateMany entry',
              );
            });
        }
      },
    );

    // syncDescendantsUpdate fires after a bulk rename completes. Now that
    // Stage 2 routes the bulk rename via 'updateMany' + rename-prefix, this
    // signal is informational only — vault has already been updated by the
    // time this fires. Kept as a debug log so operators can correlate logs
    // during incident response.
    pageEvent.on(
      'syncDescendantsUpdate',
      (_targetPage: unknown, _user: unknown) => {
        logger.debug(
          'vault-dispatcher: received syncDescendantsUpdate (handled by updateMany subscriber)',
        );
      },
    );

    // syncDescendantsDelete fires after bulk descendant deletion.
    // The individual delete events are sufficient for vault_instructions;
    // this bulk event does not map to a distinct instruction type.
    pageEvent.on('syncDescendantsDelete', (_pages: unknown, _user: unknown) => {
      logger.debug(
        'vault-dispatcher: received syncDescendantsDelete (no-op for vault)',
      );
    });

    // 'descendantsGrantChanged' fires after updateChildPagesGrant has applied
    // a bulk grant change to descendant pages. Without this signal, GROWI's
    // updateChildPagesGrant performs a silent Page.bulkWrite() that leaves the
    // vault holding the pre-change grant — an ACL leak.
    //
    // We translate the bulk event into N per-page acl-change events: each
    // affected page gets remove instructions for its previous namespaces and
    // upsert instructions for its current namespaces. The dispatcher already
    // handles acl-change atomically (see VaultDispatcher.onPageChanged), so
    // routing through it keeps the well-tested code path on the critical ACL
    // path.
    pageEvent.on(
      'descendantsGrantChanged',
      (payload?: {
        affectedPages?: Array<{
          page: IPage & { _id: { toString(): string }; revision?: unknown };
          previousGrant: unknown;
          previousGrantedGroups: unknown;
          previousGrantedUsers: unknown;
          newGrant: unknown;
          newGrantedGroups: unknown;
          newGrantedUsers: unknown;
        }>;
        user?: unknown;
      }) => {
        const items = payload?.affectedPages;
        if (!Array.isArray(items) || items.length === 0) return;

        for (const item of items) {
          // Build a minimal page view with the PREVIOUS grant state so the
          // namespace mapper computes the old namespaces correctly.
          const previousPageView = {
            ...item.page,
            grant: item.previousGrant,
            grantedGroups: item.previousGrantedGroups,
            grantedUsers: item.previousGrantedUsers,
          } as unknown as IPage;
          const previousNamespaces =
            vaultNamespaceMapper.computePageNamespaces(
              previousPageView,
            ).current;

          // Build a "current state" view so the dispatcher computes new
          // namespaces against the post-change grant.
          const currentPageView = {
            ...item.page,
            grant: item.newGrant,
            grantedGroups: item.newGrantedGroups,
            grantedUsers: item.newGrantedUsers,
          } as unknown as IPage & { _id: { toString(): string } };

          const revisionId =
            item.page.revision == null
              ? undefined
              : typeof item.page.revision === 'object' &&
                  '_id' in (item.page.revision as object)
                ? (
                    item.page.revision as { _id: { toString(): string } }
                  )._id.toString()
                : (item.page.revision as { toString(): string }).toString();

          dispatcher
            .onPageChanged({
              type: 'acl-change',
              page: currentPageView,
              previousNamespaces,
              revisionId,
            })
            .catch((err) => {
              logger.warn(
                { err },
                'vault-dispatcher: error handling descendantsGrantChanged entry',
              );
            });
        }
      },
    );

    logger.info(
      'GROWI Vault: VaultDispatcher subscribed to PageService events',
    );
  } else {
    logger.info(
      'GROWI Vault: feature is disabled; VaultDispatcher not subscribed',
    );
  }

  // ------------------------------------------------------------------
  // Step 1.5: Run startup state migration before bootstrapper dispatch.
  // This is idempotent and must execute on every boot so that:
  //   - fresh installs get a singleton doc with all required fields,
  //   - pre-resilience installs get the 14 new fields back-filled, and
  //   - stale 'running' states (no instanceId) are normalized to 'failed'.
  // ------------------------------------------------------------------
  await runVaultSyncStateMigration();

  // ------------------------------------------------------------------
  // Step 1.6: Reconcile history store — normalize stale lifecycle records.
  //
  // Any reconcile log entries left in 'running' or 'pending' state from a
  // previous process run are marked 'failed' so the history is consistent
  // after a restart. Must run before the resilience layer starts (req 7.3).
  // ------------------------------------------------------------------
  const historyStore = createHistoryStore({
    vaultReconcileLog: VaultReconcileLog,
  });
  const staleCleaned = await historyStore.normalizeStaleLifecycle();
  if (staleCleaned > 0) {
    logger.info(
      `GROWI Vault: normalized ${staleCleaned} stale reconcile log entries on startup`,
    );
  }

  // ------------------------------------------------------------------
  // Step 2: VaultBootstrapper — BootstrapTriggerResolver-driven startup.
  //
  // initOnStartup() reads VAULT_BOOTSTRAP_ON_START internally and dispatches
  // to the resilience layer with the correct trigger source:
  //   'true'  → bootstrap('env-true')  via trigger resolver (skip if done)
  //   'force' → bootstrap('env-force') via trigger resolver (always wipe)
  //   'false' → no bootstrap; drift detector still starts
  //
  // The drift detector starts in all cases so that drift sweeps run once
  // bootstrapState reaches 'done', regardless of the env value.
  // ------------------------------------------------------------------
  const bootstrapper = createVaultBootstrapper(vaultNamespaceMapper);

  const vaultBootstrapOnStart = configManager.getConfig(
    'app:vaultBootstrapOnStart',
  );
  logger.info(
    `GROWI Vault: VAULT_BOOTSTRAP_ON_START=${vaultBootstrapOnStart} — initialising resilience layer`,
  );

  // initOnStartup() handles trigger resolution and drift detector startup.
  // For env=true: blocks until the full bootstrap stream completes, then starts drift detector.
  // For env=force / env=false: returns promptly (bootstrap is background or skipped).
  await bootstrapper.initOnStartup();

  // ------------------------------------------------------------------
  // Step 3: VaultReconcileService — initialise after resilience layer is ready.
  //
  // createVaultReconcileService wires the acceptance gate + concurrency
  // controller + orchestrator. Must be created after initOnStartup() so the
  // bootstrapper is ready to answer getStatus() calls (req 4.3).
  // ------------------------------------------------------------------
  // Resolve the Page Mongoose model via its factory; passing `crowi` so the
  // model picks up the crowi-bound schema augmentations defined in
  // ~/server/models/page.
  const pageModelFactory = (await import('~/server/models/page')).default;
  const pageModel = pageModelFactory(crowi);

  // Adapter exposing the bootstrapper as the minimal ReconcileResilienceLayer
  // shape expected by VaultReconcileService. getResilienceStatus() returns the
  // full ResilienceStatus, which already carries a `bootstrap.state` field.
  const reconcileResilienceLayer = {
    getStatus: () => bootstrapper.getResilienceStatus(),
  };

  _reconcileService = createVaultReconcileService({
    pageModel: pageModel as never,
    targetResolver: await import(
      './services/reconcile/reconcile-target-resolver'
    ),
    aclEvaluator: (
      await import('./services/reconcile/reconcile-acl-evaluator')
    ).createAclEvaluator({
      pageModel: pageModel as never,
      pageGrantService: crowi.pageGrantService,
    }),
    concurrencyController: (
      await import('./services/reconcile/reconcile-concurrency-controller')
    ).createConcurrencyController({
      maxConcurrentPerUser: configManager.getConfig(
        'app:vaultReconcileMaxConcurrentPerUser',
      ),
      maxConcurrentSystem: configManager.getConfig(
        'app:vaultReconcileMaxConcurrentSystem',
      ),
      adminBypassCapacityLimit: configManager.getConfig(
        'app:vaultReconcileAdminBypassCapacityLimit',
      ),
    }),
    historyStore,
    orchestrator: (
      await import('./services/reconcile/reconcile-orchestrator')
    ).createReconcileOrchestrator({
      pageModel: pageModel as never,
      vaultInstruction: VaultInstruction,
      vaultNamespaceMapper: vaultNamespaceMapper as never,
      vaultReconcileLog: VaultReconcileLog,
      chunkSize: configManager.getConfig('app:vaultReconcileChunkSize'),
    }),
    resilienceLayer: reconcileResilienceLayer,
    configManager,
  });
  logger.info('GROWI Vault: VaultReconcileService initialised');

  // ------------------------------------------------------------------
  // Graceful shutdown: stop heartbeat, drift scheduler, and reconcile service.
  // ------------------------------------------------------------------
  const stopAll = () => {
    bootstrapper.stop().catch((err) => {
      logger.error({ err }, 'GROWI Vault: error stopping resilience layer');
    });
    _reconcileService?.stop().catch((err) => {
      logger.error({ err }, 'GROWI Vault: error stopping reconcile service');
    });
  };
  process.once('SIGTERM', stopAll);
  process.once('SIGINT', stopAll);
};
