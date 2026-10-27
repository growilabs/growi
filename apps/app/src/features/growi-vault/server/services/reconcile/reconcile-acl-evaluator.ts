/**
 * reconcile-acl-evaluator.ts
 *
 * Pure adapter that maps (user, isAdmin, baseQuery) → { eligibleQuery }.
 *
 * - Admin path: returns baseQuery unchanged, no DB I/O.
 * - Non-admin path: fetches the user's related groups once via
 *   pageGrantService.getUserRelatedGroups, then merges the grant filter
 *   conditions into the base query via PageQueryBuilder.
 *
 * IMPORTANT: This adapter never calls countDocuments or any count-class API.
 * The accept-gate page-count check is handled upstream by ReconcileService
 * using pages.descendantCount (req 6.2).
 *
 * Requirements: 2.2, 2.3, 2.4, 2.5
 */

import type { IUserHasId } from '@growi/core';

import type { IPageGrantService } from '~/server/service/page-grant';

import type { PageQueryFilter } from './reconcile-target-resolver';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/**
 * Result returned by buildEligibleQuery.
 * Contains only the merged Mongoose FilterQuery — never a count.
 */
export interface AclFilterResult {
  readonly eligibleQuery: PageQueryFilter;
}

/**
 * Adapter that converts a base page query into an ACL-scoped eligible query.
 */
export interface AclEvaluator {
  buildEligibleQuery(opts: {
    user: IUserHasId;
    isAdmin: boolean;
    baseQuery: PageQueryFilter;
  }): Promise<AclFilterResult>;
}

// ---------------------------------------------------------------------------
// Minimal slice of PageModel needed by this adapter
// ---------------------------------------------------------------------------

/**
 * The subset of the Page Mongoose model that AclEvaluator requires:
 * - find(filter): returns a Query whose .and() chain and .getFilter() method
 *   we use to extract the merged filter object.
 * - PageQueryBuilder: the constructor class that wraps a Mongoose query and
 *   exposes addConditionToFilteringByViewer.
 */
export interface AclEvaluatorPageModel {
  find(filter: PageQueryFilter): unknown;
  PageQueryBuilder: new (
    query: unknown,
    includeEmpty?: boolean,
  ) => {
    query: { getFilter(): PageQueryFilter };
    addConditionToFilteringByViewer(
      user: IUserHasId,
      groupIds: unknown[],
      includeAnyoneWithTheLink: boolean,
      showPagesRestrictedByOwner: boolean,
      showPagesRestrictedByGroup: boolean,
    ): unknown;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an AclEvaluator bound to the given dependencies.
 *
 * @param deps.pageModel    - Mongoose Page model (must expose PageQueryBuilder).
 * @param deps.pageGrantService - Service that resolves user group memberships.
 */
export function createAclEvaluator(deps: {
  pageModel: AclEvaluatorPageModel;
  pageGrantService: Pick<IPageGrantService, 'getUserRelatedGroups'>;
}): AclEvaluator {
  const { pageModel, pageGrantService } = deps;

  return {
    async buildEligibleQuery({ user, isAdmin, baseQuery }) {
      // Admin path: no grant restriction, return baseQuery as-is with no DB I/O.
      if (isAdmin) {
        return { eligibleQuery: baseQuery };
      }

      // Non-admin path:
      // 1. Resolve user's related groups (exactly 1 DB query).
      const userRelatedGroups =
        await pageGrantService.getUserRelatedGroups(user);

      // 2. Map groups to their _id values for the grant filter.
      //    getUserRelatedGroups returns PopulatedGrantedGroup[] = { type, item }.
      //    The _id lives on item (UserGroupDocument / ExternalUserGroupDocument).
      const groupIds = userRelatedGroups.map((g) => g.item._id);

      // 3. Build a Mongoose query from baseQuery and apply the viewer condition.
      //    PageQueryBuilder wraps the query and AND-merges the grant condition.
      //    Flags: includeAnyoneWithTheLink=false, showPagesRestrictedByOwner=false,
      //           showPagesRestrictedByGroup=false — matches the spec semantics
      //    (req 2.3): GRANT_PUBLIC / GRANT_OWNER / GRANT_SPECIFIED /
      //    GRANT_USER_GROUP for the user's own groups only.
      const baseMongooseQuery = pageModel.find(baseQuery);
      const builder = new pageModel.PageQueryBuilder(baseMongooseQuery, true);
      builder.addConditionToFilteringByViewer(
        user,
        groupIds,
        false,
        false,
        false,
      );

      // 4. Extract the merged FilterQuery from the builder's internal query.
      //    getFilter() is the public Mongoose 6 API (equivalent to ._conditions).
      const eligibleQuery = builder.query.getFilter();

      return { eligibleQuery };
    },
  };
}
