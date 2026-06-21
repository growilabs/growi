import createError from 'http-errors';

import type { PageQuery } from './generate-base-query';

/**
 * add sort condition(sort key & sort order)
 *
 * If only the reverse option is specified, the sort key is 'path'.
 * If only the sort key is specified, the sort order is the ascending order.
 *
 */
export const addSortCondition = (
  query: PageQuery,
  optionsSortArg?: string,
  optionsReverse?: string,
): PageQuery => {
  // init sort key
  const optionsSort = optionsSortArg ?? 'path';

  // the default sort order
  const isReversed = optionsReverse === 'true';

  if (
    optionsSort !== 'path' &&
    optionsSort !== 'createdAt' &&
    optionsSort !== 'updatedAt'
  ) {
    throw createError(
      400,
      `The specified value '${optionsSort}' for the sort option is invalid. It must be 'path', 'createdAt' or 'updatedAt'.`,
    );
  }

  const sortOption = {};
  sortOption[optionsSort] = isReversed ? -1 : 1;
  return query.sort(sortOption);
};
