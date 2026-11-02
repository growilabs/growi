const MAX_PAGE_DEPTH = 129;

/**
 * Whether path is nested deeper than a page is allowed to be.
 * Counted rather than matched: a pattern like /^(\/.+){130,}$/ backtracks
 * exponentially in the number of slashes.
 * @param path
 */
export const exceedsMaxPageDepth = (path: string): boolean => {
  return (
    path.startsWith('/') &&
    path.split('/').filter((segment) => segment !== '').length > MAX_PAGE_DEPTH
  );
};
