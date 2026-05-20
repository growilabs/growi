import { type IPage, PageGrant } from '@growi/core';
import type { Namespace } from '@growi/core/dist/interfaces/vault';

import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import UserGroupRelation from '~/server/models/user-group-relation';

/**
 * Interface for computing GROWI ACL-based namespace mappings for the Vault feature.
 *
 * Two primary operations are supported:
 *  1. computeAccessibleNamespaces – determines the full set of namespaces a user
 *     may access during a git clone / fetch operation.
 *  2. computePageNamespaces – determines which namespace(s) a single page belongs
 *     to based on its grant settings.
 */
export interface VaultNamespaceMapper {
  computeAccessibleNamespaces(
    userId: string | null,
    scopes?: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<Namespace>>;

  computePageNamespaces(page: IPage): {
    current: ReadonlyArray<Namespace>;
    previous?: ReadonlyArray<Namespace>;
  };
}

/**
 * Resolve all group IDs (internal + external) that a given user belongs to.
 *
 * Both UserGroupRelation and ExternalUserGroupRelation expose the same static
 * findAllUserGroupIdsRelatedToUser(user) API where `user` must be an object
 * with an `_id` property.
 */
const resolveGroupIds = async (userId: string): Promise<string[]> => {
  const userLike = { _id: userId };

  const [internalIds, externalIds] = await Promise.all([
    UserGroupRelation.findAllUserGroupIdsRelatedToUser(userLike),
    ExternalUserGroupRelation.findAllUserGroupIdsRelatedToUser(userLike),
  ]);

  // Deduplicate and convert ObjectIdLike values to plain strings
  const combined = new Set([
    ...internalIds.map((id) => id.toString()),
    ...externalIds.map((id) => id.toString()),
  ]);

  return [...combined];
};

/**
 * Derive the namespace list for a page based on its grant and grantedGroups.
 *
 * This function is intentionally trash-agnostic and status-agnostic.
 * Exclusion of trashed or non-published pages is the vault-manager's
 * responsibility (via isExcludedFromVault() in op handlers), not the
 * apps/app layer's (req 6.3).
 */
const derivePageNamespaces = (page: IPage): ReadonlyArray<Namespace> => {
  switch (page.grant) {
    case PageGrant.GRANT_PUBLIC:
      return ['public'];

    case PageGrant.GRANT_RESTRICTED:
      return ['restricted-link'];

    case PageGrant.GRANT_USER_GROUP: {
      // Each granted group maps to a distinct namespace (req 3.4)
      const groups = page.grantedGroups ?? [];
      return groups.map((g) => `group-${g.item.toString()}`);
    }

    case PageGrant.GRANT_OWNER: {
      // Creator ID identifies the private namespace (req 3.5)
      const creatorId = page.creator?.toString();
      if (creatorId == null) {
        return [];
      }
      return [`user-${creatorId}-only-me`];
    }

    default:
      return [];
  }
};

/**
 * Factory function that creates the VaultNamespaceMapper implementation.
 *
 * Kept as a factory rather than a class so the unit tests can inject mocks
 * without needing class instantiation boilerplate.
 */
export const createVaultNamespaceMapper = (): VaultNamespaceMapper => {
  return {
    /**
     * Compute the full set of namespaces accessible to a user.
     *
     * Anonymous (userId === null): only the 'public' namespace.
     * Authenticated: 'public', 'restricted-link', one 'group-<gid>' per group,
     *   and 'user-<uid>-only-me' for the user's own private pages.
     *
     * @param userId - The authenticated user's ID, or null for anonymous access.
     * @param scopes - PAT scopes from the authentication result (req 2.5).
     *   MVP: scopes filtering not applied; future vault-specific scopes can
     *   restrict namespace access here (e.g. a 'read:vault:public-only' scope
     *   could limit the result to ['public']). The parameter is accepted now
     *   so the call-site API is stable and callers can propagate scopes without
     *   further interface changes.
     */
    async computeAccessibleNamespaces(
      userId: string | null,
      _scopes?: ReadonlyArray<string>,
    ): Promise<ReadonlyArray<Namespace>> {
      // Anonymous users can only access public content (req 3.2)
      if (userId === null) {
        return ['public'];
      }

      // Resolve all groups the user belongs to (internal + external)
      const groupIds = await resolveGroupIds(userId);

      const namespaces: Namespace[] = [
        'public',
        'restricted-link',
        ...groupIds.map((gid) => `group-${gid}`),
        `user-${userId}-only-me`,
      ];

      return namespaces;
    },

    /**
     * Compute the namespace(s) a page belongs to.
     *
     * The returned object always contains a `current` array reflecting the page's
     * present grant state. The optional `previous` field is reserved for ACL-change
     * scenarios where the caller provides the prior page state — this implementation
     * does not populate `previous` (callers handle that by invoking this method
     * with both the old and new page objects and treating the old result as
     * `previous`).
     */
    computePageNamespaces(page: IPage): {
      current: ReadonlyArray<Namespace>;
      previous?: ReadonlyArray<Namespace>;
    } {
      return { current: derivePageNamespaces(page) };
    },
  };
};

/**
 * Default singleton instance for use in production code paths.
 */
export const vaultNamespaceMapper = createVaultNamespaceMapper();
