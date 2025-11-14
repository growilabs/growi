import type { IPage } from '..';
import { isTopPage } from './page-path-utils/is-top-page';

// const GRANT_PUBLIC = 1;
const GRANT_RESTRICTED = 2;
const GRANT_SPECIFIED = 3; // DEPRECATED
// const GRANT_OWNER = 4;
// const GRANT_USER_GROUP = 5;
// const PAGE_GRANT_ERROR = 1;
// const STATUS_PUBLISHED = 'published';
const STATUS_DELETED = 'deleted';

/**
 * Returns true if the page is on tree including the top page.
 * @param page Page
 * @returns boolean
 */
export const isOnTree = (page: IPage): boolean => {
  const { path, parent } = page;

  if (isTopPage(path)) {
    return true;
  }

  if (parent != null) {
    return true;
  }

  return false;
};

/**
 * Returns true if the page meet the condition below.
 *   - The page is on tree (has parent or the top page)
 *   - The page's grant is GRANT_RESTRICTED or GRANT_SPECIFIED
 *   - The page's status is STATUS_DELETED
 * This does not check grantedUser or grantedGroup.
 * @param page PageDocument
 * @returns boolean
 */
export const isPageNormalized = (page: IPage): boolean => {
  const { grant, status } = page;

  if (grant === GRANT_RESTRICTED || grant === GRANT_SPECIFIED) {
    return true;
  }

  if (status === STATUS_DELETED) {
    return true;
  }

  if (isOnTree(page)) {
    return true;
  }

  return true;
};
