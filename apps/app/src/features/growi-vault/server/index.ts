import type { IPage } from '@growi/core';
import type { Router } from 'express';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

import { createVaultAdminRouter } from './routes/vault-admin';
import { createVaultGatewayRouter } from './routes/vault-gateway';
import { createVaultBootstrapper } from './services/vault-bootstrapper';
import { createVaultDispatcher } from './services/vault-dispatcher';
import { vaultNamespaceMapper } from './services/vault-namespace-mapper';
import { vaultSettingsService } from './services/vault-settings-service';

export { createVaultAdminRouter } from './routes/vault-admin';
export { createVaultGatewayRouter } from './routes/vault-gateway';

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
  return createVaultAdminRouter({ crowi, bootstrapper });
};

const logger = loggerFactory('growi:features:growi-vault:server');

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
    //   { page, oldPath, newPath, user }. We translate this into a
    //   rename-prefix instruction per affected namespace.
    pageEvent.on(
      'rename',
      (payload?: {
        page?: IPage & { _id: { toString(): string } };
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
        const { current } = vaultNamespaceMapper.computePageNamespaces(
          payload.page,
        );
        if (current.length === 0) return;
        dispatcher
          .onBulkOperation({
            type: 'rename-prefix',
            namespaces: current,
            oldPrefix: payload.oldPath,
            newPrefix: payload.newPath,
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
  // Step 2: VaultBootstrapper — auto-start when VAULT_BOOTSTRAP_ON_START=true
  // ------------------------------------------------------------------
  const bootstrapper = createVaultBootstrapper(vaultNamespaceMapper);

  const vaultBootstrapOnStart = configManager.getConfig(
    'app:vaultBootstrapOnStart',
  );
  if (vaultBootstrapOnStart === 'true' || vaultBootstrapOnStart === 'force') {
    logger.info(
      `GROWI Vault: VAULT_BOOTSTRAP_ON_START=${vaultBootstrapOnStart} — starting bootstrap on startup`,
    );
    // Fire-and-forget: bootstrap is a long-running background operation.
    bootstrapper.start({ triggerSource: 'env-var' }).catch((err) => {
      logger.error({ err }, 'GROWI Vault: bootstrap failed during startup');
    });
  }
};
