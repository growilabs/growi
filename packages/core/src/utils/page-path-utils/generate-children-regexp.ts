import { escapeStringForMongoRegex } from '../escape-string-for-regex.js';
import { isTopPage } from './is-top-page.js';

/**
 * Generate RegExp instance for one level lower path
 */
export const generateChildrenRegExp = (path: string): RegExp => {
  // https://regex101.com/r/laJGzj/1
  // ex. /any_level1
  if (isTopPage(path)) return new RegExp(/^\/[^/]+$/);

  // https://regex101.com/r/mrDJrx/1
  // ex. /parent/any_child OR /any_level1
  // NOTE: use escapeStringForMongoRegex (not RegExp.escape) because this pattern is sent to
  // MongoDB ($regex). RegExp.escape would emit \uXXXX for non-ASCII whitespace (e.g. U+3000),
  // which PCRE2 rejects (error 51091).
  return new RegExp(`^${escapeStringForMongoRegex(path)}(\\/[^/]+)\\/?$`);
};
