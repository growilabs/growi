import type { OperationRecord, ViewerRole } from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import { loadViewablePages } from './current-page-facts';
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

/**
 * Which of a proposal's operations the viewer sees, may decide, and the stage
 * those alone imply. The page queries do not grow with the number of
 * operations: the ancestor candidates of all of them at once, then one viewing
 * check (which also asks, for pages it could not return, whether they exist).
 */
export const resolveReviewScope = async (
  operations: readonly OperationRecord[],
  viewer: ViewerIdentity,
  role: ViewerRole,
): Promise<ReviewScopeResult> => {
  const nonEmptyPageIdByPath = await loadNonEmptyPageIdByPath(
    ancestorPathsToLoad(operations, role),
  );
  const viewable = await loadViewablePages(
    pageIdsToLoad(operations, role, nonEmptyPageIdByPath),
    { _id: viewer.userId },
    viewer,
  );
  return decideReviewScope(operations, role, {
    viewable,
    nonEmptyPageIdByPath,
  });
};
