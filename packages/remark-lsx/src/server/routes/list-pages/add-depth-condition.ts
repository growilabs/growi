import type { ParseRangeResult } from '@growi/core/dist/remark-plugins';
import createError from 'http-errors';

import { getDepthOfPath } from '../../../utils/depth-utils';
import type { PageQuery } from './generate-base-query';

export const addDepthCondition = (
  query: PageQuery,
  pagePath: string,
  depthRange: ParseRangeResult | null,
): PageQuery => {
  if (depthRange == null) {
    return query;
  }

  const { start, end } = depthRange;

  // check start
  if (start < 1) {
    throw createError(
      400,
      `The specified option 'depth' is { start: ${start}, end: ${end} } : the start must be larger or equal than 1`,
    );
  }
  // check end
  if (start > end && end > 0) {
    throw createError(
      400,
      `The specified option 'depth' is { start: ${start}, end: ${end} } : the end must be larger or equal than the start`,
    );
  }

  const depthOfPath = getDepthOfPath(pagePath);
  const slashNumStart = depthOfPath + depthRange.start;
  const slashNumEnd = depthOfPath + depthRange.end;

  if (end < 0) {
    return query.and([
      { path: new RegExp(`^(\\/[^\\/]*){${slashNumStart},}$`) },
    ]);
  }

  return query.and([
    { path: new RegExp(`^(\\/[^\\/]*){${slashNumStart},${slashNumEnd}}$`) },
  ]);
};
