import type { PageQuery } from './generate-base-query.js';

/**
 * Add a condition that restricts the query to pages whose _id is included
 * in the given (already tag-resolved) pageIds.
 *
 * An empty pageIds array is a valid input (no tag matched, or no page has
 * all the specified tags): it must not throw, and the resulting condition
 * must match zero pages rather than being skipped.
 */
export const addTagCondition = (
  query: PageQuery,
  pageIds: string[],
): PageQuery => {
  return query.and([{ _id: { $in: pageIds } }]);
};
