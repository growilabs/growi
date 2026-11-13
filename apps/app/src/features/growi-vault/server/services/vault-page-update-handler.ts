import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageUpdateEventExtras } from '~/server/events/page';
import type { PageDocument, PageModel } from '~/server/models/page';

import type { VaultDispatcher } from './vault-dispatcher';
import type {
  PageGrantState,
  VaultNamespaceMapper,
} from './vault-namespace-mapper';

type UpdatedPage = IPage & { _id: { toString(): string } };

export type VaultPageUpdateHandler = (
  page: UpdatedPage,
  extras?: PageUpdateEventExtras,
) => Promise<void>;

/** Resolves to null when the page no longer exists. */
export type ReadStoredGrantState = (
  pageId: string,
) => Promise<PageGrantState | null>;

export const readStoredGrantState: ReadStoredGrantState = async (pageId) =>
  mongoose
    .model<PageDocument, PageModel>('Page')
    .findById(pageId, { grant: 1, grantedGroups: 1, grantedUsers: 1 })
    .lean();

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
  readGrantState: ReadStoredGrantState,
): VaultPageUpdateHandler => {
  return async (page, extras) => {
    const revisionId = resolveRevisionId(page.revision);

    if (extras == null) {
      await dispatcher.onPageChanged({ type: 'update', page, revisionId });
      return;
    }

    const previousGrantState: PageGrantState = {
      grant: extras.previousGrant,
      grantedGroups: extras.previousGrantedGroups,
      grantedUsers: extras.previousGrantedUsers,
    };
    // The emitted page's grant can be stale: a body save does not re-check
    // a grant changed after it loaded the page.
    const storedGrantState = await readGrantState(page._id.toString());

    if (storedGrantState == null) {
      await dispatcher.onPageChanged({
        type: 'delete',
        page: { _id: page._id, path: page.path, ...previousGrantState },
      });
      return;
    }

    const { current: previousNamespaces } =
      namespaceMapper.computePageNamespaces(previousGrantState);
    await dispatcher.onPageChanged({
      type: 'acl-change',
      page: {
        _id: page._id,
        path: page.path,
        grant: storedGrantState.grant,
        grantedGroups: storedGrantState.grantedGroups,
        grantedUsers: storedGrantState.grantedUsers,
      },
      previousNamespaces,
      revisionId,
    });
  };
};
