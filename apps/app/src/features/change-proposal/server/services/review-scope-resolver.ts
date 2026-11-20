import type { ViewerRole } from '../../interfaces';
import type { ReviewScopeOperation, ViewerIdentity } from '../domain';
import { loadViewablePages, type ViewablePages } from './current-page-facts';
import { pageModel } from './operation-handlers/page-model';
import {
  ancestorPathsToLoad,
  decideReviewScope,
  pageIdsToLoad,
  type ReviewScopeResult,
} from './review-scope-visibility';

export type { ReviewScopeResult } from './review-scope-visibility';

// Not filtered by the viewer: the closest non-empty ancestor decides, whatever its
// grant, and only then is the viewer's access to it checked.
const loadNonEmptyPageIdByPath = async (
  paths: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
  if (paths.length === 0) {
    return new Map();
  }
  const pages = await pageModel()
    .find(
      {
        path: { $in: paths },
        // isEmpty null: v4 pages, as in PageQueryBuilder
        $or: [{ isEmpty: false }, { isEmpty: null }],
      },
      { _id: 1, path: 1 },
    )
    .lean()
    .exec();
  const byPath = new Map<string, string[]>();
  for (const page of pages) {
    byPath.set(page.path, [
      ...(byPath.get(page.path) ?? []),
      page._id.toString(),
    ]);
  }
  return byPath;
};

export type ReviewScopeSubject = {
  readonly operations: readonly ReviewScopeOperation[];
  readonly role: ViewerRole;
};

/**
 * resolveReviewScope for several proposals at once, each by the viewer's role
 * in it, with `alsoCheckPageIds` checked in the same viewing check and every
 * page it read handed back, for a caller that shows pages next to the
 * operations without checking them a second time.
 */
export const resolveReviewScopesWithPages = async (
  subjects: readonly ReviewScopeSubject[],
  viewer: ViewerIdentity,
  alsoCheckPageIds: readonly string[],
): Promise<{
  readonly scopes: readonly ReviewScopeResult[];
  readonly viewable: ViewablePages;
}> => {
  const nonEmptyPageIdByPath = await loadNonEmptyPageIdByPath([
    ...new Set(
      subjects.flatMap((s) => ancestorPathsToLoad(s.operations, s.role)),
    ),
  ]);
  const viewable = await loadViewablePages(
    [
      ...subjects.flatMap((s) =>
        pageIdsToLoad(s.operations, s.role, nonEmptyPageIdByPath),
      ),
      ...alsoCheckPageIds,
    ],
    { _id: viewer.userId },
    viewer,
  );
  return {
    scopes: subjects.map((s) =>
      decideReviewScope(s.operations, s.role, {
        viewable,
        nonEmptyPageIdByPath,
      }),
    ),
    viewable,
  };
};

/**
 * Which of a proposal's operations the viewer sees, may decide, and the stage
 * those alone imply. The page queries do not grow with the number of
 * operations: the ancestor candidates of all of them at once, then one viewing
 * check (which also asks, for pages it could not return, whether they exist).
 */
export const resolveReviewScope = async (
  operations: readonly ReviewScopeOperation[],
  viewer: ViewerIdentity,
  role: ViewerRole,
): Promise<ReviewScopeResult> => {
  const { scopes } = await resolveReviewScopesWithPages(
    [{ operations, role }],
    viewer,
    [],
  );
  return scopes[0];
};
