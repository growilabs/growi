import type { IPage } from '@growi/core';

import type { PageUpdateEventExtras } from '~/server/events/page';

import type { VaultDispatcher } from './vault-dispatcher';
import type { VaultNamespaceMapper } from './vault-namespace-mapper';

type UpdatedPage = IPage & { _id: { toString(): string } };

export type VaultPageUpdateHandler = (
  page: UpdatedPage,
  extras?: PageUpdateEventExtras,
) => Promise<void>;

const resolveRevisionId = (
  revision: UpdatedPage['revision'],
): string | undefined => {
  if (revision == null) {
    return undefined;
  }
  return typeof revision === 'object' && '_id' in revision
    ? revision._id.toString()
    : revision.toString();
};

/**
 * Builds the subscriber for the page 'update' event. When the update moved
 * the page out of a namespace, the page is removed from it; otherwise the
 * update is a plain upsert.
 */
export const createVaultPageUpdateHandler = (
  dispatcher: Pick<VaultDispatcher, 'onPageChanged'>,
  namespaceMapper: Pick<VaultNamespaceMapper, 'computePageNamespaces'>,
): VaultPageUpdateHandler => {
  const resolveLeftNamespaces = (
    page: UpdatedPage,
    extras: PageUpdateEventExtras | undefined,
  ): ReadonlyArray<string> => {
    if (extras == null) {
      return [];
    }
    const { current: previous } = namespaceMapper.computePageNamespaces({
      grant: extras.previousGrant,
      grantedGroups: extras.previousGrantedGroups,
      grantedUsers: extras.previousGrantedUsers,
    });
    const { current } = namespaceMapper.computePageNamespaces(page);
    return previous.filter((ns) => !current.includes(ns));
  };

  return async (page, extras) => {
    const revisionId = resolveRevisionId(page.revision);
    const leftNamespaces = resolveLeftNamespaces(page, extras);

    if (leftNamespaces.length === 0) {
      await dispatcher.onPageChanged({ type: 'update', page, revisionId });
      return;
    }

    // Only the namespaces the page left are passed: a namespace it still
    // belongs to must not receive a remove next to its upsert.
    await dispatcher.onPageChanged({
      type: 'acl-change',
      page,
      previousNamespaces: leftNamespaces,
      revisionId,
    });
  };
};
