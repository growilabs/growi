import escapeStringRegexp from 'escape-string-regexp';

import { isTopPage } from './is-top-page';

/**
 * Generate RegExp instance for one level lower path
 */
export const generateChildrenRegExp = (path: string): RegExp => {
  // https://regex101.com/r/laJGzj/1
  // ex. /any_level1
  if (isTopPage(path)) return new RegExp(/^\/[^/]+$/);

  // https://regex101.com/r/mrDJrx/1
  // ex. /parent/any_child OR /any_level1
  return new RegExp(`^${escapeStringRegexp(path)}(\\/[^/]+)\\/?$`);
};
