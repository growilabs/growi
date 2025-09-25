import createError from 'http-errors';

import type { PageQuery } from './generate-base-query';

const DEFAULT_PAGES_NUM = 50;

/**
 * add num condition that limit fetched pages
 */
export const addNumCondition = (
  query: PageQuery,
  offset = 0,
  limit = DEFAULT_PAGES_NUM,
): PageQuery => {
  // check offset
  if (offset < 0) {
    throw createError(400, "The param 'offset' must be larger or equal than 0");
  }
  // check offset
  if (offset < 0) {
    throw createError(400, "The param 'offset' must be larger or equal than 0");
  }

  let q = query;
  if (offset > 0) {
    q = q.skip(offset);
  }
  if (limit >= 0) {
    q = q.limit(limit);
  }

  return q;
};
