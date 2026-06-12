/**
 * Escape a string for safe use inside a regular expression that is sent to MongoDB
 * (`$regex` / `new RegExp(...)` used in a query). MongoDB evaluates regular expressions
 * with the PCRE2 engine.
 *
 * Why not `RegExp.escape()`:
 *   Node.js 24's built-in `RegExp.escape()` escapes non-ASCII whitespace
 *   (code points >= U+0100, e.g. U+3000 IDEOGRAPHIC SPACE) into `\uXXXX` form.
 *   PCRE2 does not support `\u`, so such a pattern makes MongoDB throw
 *   "Regular expression is invalid: PCRE2 does not support ... \u" (error 51091).
 *
 * This helper instead escapes only regex metacharacters and passes every other
 * character through literally — behaviourally identical to `escape-string-regexp` v5,
 * which is what GROWI used before the v7.5.0 refactor. The output never contains `\u`,
 * so it is safe to hand to MongoDB.
 *
 * Use this (not `RegExp.escape`) whenever the resulting pattern is sent to MongoDB.
 * For in-process JS regex (`.test()` / `.replace()`), `RegExp.escape` is fine.
 */
export const escapeStringForMongoRegex = (str: string): string => {
  return str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
};
