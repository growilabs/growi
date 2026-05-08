import type { IPage } from '@growi/core';

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
export const createVaultGatewayRouterWithDeps = (crowi: any) => {
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
export const createVaultAdminRouterWithDeps = (crowi: any) => {
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

    // syncDescendantsUpdate fires after a bulk rename completes.
    // targetPage.path is already the NEW path at this point; the old path
    // prefix is not carried by the event, so we cannot construct a full
    // rename-prefix instruction here.
    //
    // MVP limitation (P1 future work — growi-vault-gateway task 21.1):
    // rename-prefix and grant-change-prefix propagation are not implemented.
    // After a bulk rename or bulk grant change, the vault contents will become
    // stale. Operators must re-run bootstrap from the Admin UI (/admin/vault)
    // to bring the vault back in sync.
    pageEvent.on(
      'syncDescendantsUpdate',
      (_targetPage: unknown, _user: unknown) => {
        logger.warn(
          'vault-dispatcher: received syncDescendantsUpdate but rename-prefix propagation ' +
            'is not implemented in MVP (P1 future work). ' +
            'The vault contents may now be stale. ' +
            'Please re-run bootstrap from the Admin UI (/admin/vault) to bring the vault up to date.',
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

  if (configManager.getConfig('app:vaultBootstrapOnStart')) {
    logger.info(
      'GROWI Vault: VAULT_BOOTSTRAP_ON_START=true — starting bootstrap on startup',
    );
    // Fire-and-forget: bootstrap is a long-running background operation.
    bootstrapper.start({ triggerSource: 'env-var' }).catch((err) => {
      logger.error({ err }, 'GROWI Vault: bootstrap failed during startup');
    });
  }
};
