import createError from 'http-errors';

/**
 * Parse the `tag` option string into a deduplicated array of trimmed tag names.
 *
 * The caller is expected not to invoke this when `optionsTag` is `undefined`
 * (option not provided at all). This function still handles that value the
 * same way as "no value" (`true`), so a caller that does pass `undefined`
 * gets a consistent 400 error rather than a runtime type error.
 */
export function parseTagNames(optionsTag: string | true | undefined): string[] {
  // when option string is 'tag=', the option value is true
  if (optionsTag == null || optionsTag === true) {
    throw createError(400, 'tag option requires at least one tag name.');
  }

  const tagNames = optionsTag
    .split(',')
    .map((tagName) => tagName.trim())
    .filter((tagName) => tagName.length > 0);

  const uniqueTagNames = Array.from(new Set(tagNames));

  if (uniqueTagNames.length === 0) {
    throw createError(400, 'tag option requires at least one tag name.');
  }

  return uniqueTagNames;
}
