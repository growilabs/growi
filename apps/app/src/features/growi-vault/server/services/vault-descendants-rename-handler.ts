import type { EventEmitter } from 'node:events';
import type { Namespace } from '@growi/core/dist/interfaces/vault';
import { convertToNewAffiliationPath } from '@growi/core/dist/utils/page-path-utils';

import type { PageUpdateManyEventExtras } from '~/server/events/page';
import loggerFactory from '~/utils/logger';

import { resolveRevisionId } from './resolve-revision-id';
import type { DispatchedPage, VaultDispatcher } from './vault-dispatcher';
import type { VaultNamespaceMapper } from './vault-namespace-mapper';

const logger = loggerFactory(
  'growi:features:growi-vault:service:vault-descendants-rename-handler',
);

export type RenamedDescendant = DispatchedPage & {
  readonly revision?: unknown;
};

export type VaultDescendantsRenameHandler = (
  pages: ReadonlyArray<RenamedDescendant>,
  extras?: PageUpdateManyEventExtras,
) => Promise<void>;

/**
 * Builds the subscriber for the page 'updateMany' event, which PageService
 * emits for each batch of renamed descendants.
 *
 * A 'subtree' rename moves the old directory in every namespace that holds a
 * descendant, so each namespace gets its rename-prefix exactly once per
 * operation: in the first batch that contains it. A 'listed-pages' rename only
 * relocates the pages in the event, one by one.
 */
export const createVaultDescendantsRenameHandler = (
  dispatcher: Pick<VaultDispatcher, 'onPageRenamed' | 'onBulkOperation'>,
  namespaceMapper: Pick<VaultNamespaceMapper, 'computePageNamespaces'>,
): VaultDescendantsRenameHandler => {
  // Entries live only while PageService still references the operation, so
  // the map holds at most the renames currently in progress.
  const namespacesMovedByOperation = new WeakMap<object, Set<Namespace>>();

  const warnOnFailure = (dispatch: Promise<void>): Promise<void> =>
    dispatch.catch((err) => {
      logger.warn({ err }, 'vault-dispatcher: error handling updateMany entry');
    });

  return async (pages, extras) => {
    if (extras == null) {
      logger.debug(
        'vault-dispatcher: skipping updateMany without rename extras',
      );
      return;
    }
    const { oldPagePathPrefix, newPagePathPrefix } = extras;

    if (extras.scope === 'listed-pages') {
      await Promise.all(
        pages.map((page) =>
          warnOnFailure(
            dispatcher.onPageRenamed({
              page,
              oldPath: page.path,
              newPath: convertToNewAffiliationPath(
                oldPagePathPrefix,
                newPagePathPrefix,
                page.path,
              ),
              revisionId: resolveRevisionId(page.revision),
            }),
          ),
        ),
      );
      return;
    }

    const alreadyMoved =
      namespacesMovedByOperation.get(extras.operation) ?? new Set<Namespace>();
    namespacesMovedByOperation.set(extras.operation, alreadyMoved);

    const namespacesToMove = new Set<Namespace>();
    for (const page of pages) {
      for (const ns of namespaceMapper.computePageNamespaces(page).current) {
        if (!alreadyMoved.has(ns)) namespacesToMove.add(ns);
      }
    }
    if (namespacesToMove.size === 0) return;
    // Recorded before the dispatch is awaited, so a batch arriving meanwhile
    // does not move the same namespace again.
    for (const ns of namespacesToMove) alreadyMoved.add(ns);

    await warnOnFailure(
      dispatcher.onBulkOperation({
        type: 'rename-prefix',
        namespaces: Array.from(namespacesToMove),
        oldPrefix: oldPagePathPrefix,
        newPrefix: newPagePathPrefix,
      }),
    );
  };
};

/**
 * Subscribes the Vault to the descendant renames PageService announces.
 *
 * @returns a function that removes the subscription.
 */
export const subscribeToDescendantsRename = (
  pageEvent: EventEmitter,
  dispatcher: Pick<VaultDispatcher, 'onPageRenamed' | 'onBulkOperation'>,
  namespaceMapper: Pick<VaultNamespaceMapper, 'computePageNamespaces'>,
): (() => void) => {
  const handleDescendantsRenamed = createVaultDescendantsRenameHandler(
    dispatcher,
    namespaceMapper,
  );
  const onUpdateMany = (
    pages: ReadonlyArray<RenamedDescendant> | null | undefined,
    _user: unknown,
    extras?: PageUpdateManyEventExtras,
  ): void => {
    if (!Array.isArray(pages) || pages.length === 0) return;
    handleDescendantsRenamed(pages, extras).catch((err) => {
      logger.warn({ err }, 'vault-dispatcher: error handling updateMany event');
    });
  };
  pageEvent.on('updateMany', onUpdateMany);
  return () => {
    pageEvent.off('updateMany', onUpdateMany);
  };
};
