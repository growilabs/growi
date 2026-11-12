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
 * Builds the subscriber for the page 'update' event, which reports a saved page
 * together with the grant state it had before. The dispatcher compares the namespaces
 * before and after, and removes the page from the ones it left.
 */
export const createVaultPageUpdateHandler = (
  dispatcher: Pick<VaultDispatcher, 'onPageChanged'>,
  namespaceMapper: Pick<VaultNamespaceMapper, 'computePageNamespaces'>,
): VaultPageUpdateHandler => {
  return async (page, extras) => {
    const revisionId = resolveRevisionId(page.revision);

    if (extras == null) {
      await dispatcher.onPageChanged({ type: 'update', page, revisionId });
      return;
    }

    const { current: previousNamespaces } =
      namespaceMapper.computePageNamespaces({
        grant: extras.previousGrant,
        grantedGroups: extras.previousGrantedGroups,
        grantedUsers: extras.previousGrantedUsers,
      });
    await dispatcher.onPageChanged({
      type: 'acl-change',
      page,
      previousNamespaces,
      revisionId,
    });
  };
};
