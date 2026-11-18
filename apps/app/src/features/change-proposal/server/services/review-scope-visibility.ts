import {
  APPLIED_AT_LEAST_ONCE_STATUSES,
  type ViewerRole,
} from '../../interfaces';
import {
  deriveVisibleStage,
  type ReviewScopeOperation,
  resolveAncestors,
  reviewScopeOf,
  selectVisibleOperations,
  targetPageIdOf,
  type VisibilityContext,
  type VisibleStage,
} from '../domain';
import {
  NO_REVERT_COUNTERPART,
  type RevertCounterpartValues,
} from './revert-counterparts';

export type ReviewScopeResult = {
  // The operations returned to the viewer, whatever their status.
  readonly visibleKeys: ReadonlySet<string>;
  // Derived from the visible operations alone; meaningful for non-requesters.
  readonly visibleStage: VisibleStage;
  // Visible operations still pending: what the viewer may decide.
  readonly reviewTargetKeys: ReadonlySet<string>;
};

export type ReviewScopeFacts = {
  readonly viewable: Omit<
    VisibilityContext,
    'isRequester' | keyof RevertCounterpartValues
  >;
  // Left out by callers that do not show operations on gone pages to revert
  // counterparts; they then see none.
  readonly counterpart?: RevertCounterpartValues;
  // Only non-empty pages, so resolveAncestors skips empty ones. Every page on a
  // path is kept: pages outside the tree can share one, and all of them decide.
  readonly nonEmptyPageIdByPath: ReadonlyMap<string, readonly string[]>;
};

// Applied operations keep the rule for other viewers (Req 19.10).
const isJudgedByReviewScope = (
  op: ReviewScopeOperation,
  role: ViewerRole,
): boolean =>
  role === 'reviewer' && !APPLIED_AT_LEAST_ONCE_STATUSES.includes(op.status);

// null when no page can be checked (the parent cannot be resolved, or the scope
// is empty): such an operation is never shown to a reviewer, rather than shown
// without a viewing check.
const judgingPageIdsOf = (
  op: ReviewScopeOperation,
  nonEmptyPageIdByPath: ReadonlyMap<string, readonly string[]>,
): readonly string[] | null => {
  const scope = reviewScopeOf(op);
  if (scope.ancestorPaths.length === 0) {
    return scope.pageIds.length === 0 ? null : scope.pageIds;
  }
  const ancestor = resolveAncestors(
    scope.ancestorPaths,
    new Set(nonEmptyPageIdByPath.keys()),
  );
  const ancestorIds =
    ancestor == null ? undefined : nonEmptyPageIdByPath.get(ancestor);
  return ancestorIds == null || ancestorIds.length === 0
    ? null
    : [...scope.pageIds, ...ancestorIds];
};

export const ancestorPathsToLoad = (
  operations: readonly ReviewScopeOperation[],
  role: ViewerRole,
): readonly string[] => [
  ...new Set(
    operations
      .filter((op) => isJudgedByReviewScope(op, role))
      .flatMap((op) => reviewScopeOf(op).ancestorPaths),
  ),
];

export const pageIdsToLoad = (
  operations: readonly ReviewScopeOperation[],
  role: ViewerRole,
  nonEmptyPageIdByPath: ReadonlyMap<string, readonly string[]>,
): readonly string[] => [
  ...new Set(
    operations.flatMap((op) => {
      if (isJudgedByReviewScope(op, role)) {
        return judgingPageIdsOf(op, nonEmptyPageIdByPath) ?? [];
      }
      const pageId = targetPageIdOf(op);
      return pageId == null ? [] : [pageId];
    }),
  ),
];

const isVisibleByReviewScope = (
  op: ReviewScopeOperation,
  { viewable, nonEmptyPageIdByPath }: ReviewScopeFacts,
): boolean => {
  const pageIds = judgingPageIdsOf(op, nonEmptyPageIdByPath);
  return (
    pageIds?.every(
      (id) =>
        viewable.viewablePageIds.has(id) &&
        !viewable.anyoneWithLinkPageIds.has(id),
    ) ?? false
  );
};

export const decideReviewScope = (
  operations: readonly ReviewScopeOperation[],
  role: ViewerRole,
  facts: ReviewScopeFacts,
): ReviewScopeResult => {
  const byCurrentRule = new Set(
    selectVisibleOperations(operations, {
      ...facts.viewable,
      ...(facts.counterpart ?? NO_REVERT_COUNTERPART),
      isRequester: role === 'requester',
    }),
  );
  const visible = operations.filter((op) =>
    isJudgedByReviewScope(op, role)
      ? isVisibleByReviewScope(op, facts)
      : byCurrentRule.has(op),
  );
  return {
    visibleKeys: new Set(visible.map((op) => op.key)),
    visibleStage: deriveVisibleStage(visible),
    reviewTargetKeys: new Set(
      visible.filter((op) => op.status === 'pending').map((op) => op.key),
    ),
  };
};
