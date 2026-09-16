/**
 * Case-insensitive username prefix matching, as a collated range rather than a
 * `$regex`: `$regex` is not collation-aware, so a case-insensitive pattern can
 * never be index-bounded, even anchored. Shared by the `username_ci` index and
 * every query that needs to match it — a mismatched collation silently falls
 * back to a full walk.
 */
export const USERNAME_CI_COLLATION = { locale: 'en', strength: 2 };

// Not "increment the last character": ICU sorts punctuation below letters, so
// `kahz` would become `kah{`, which compares under `kahz` and matches nothing.
const UPPER_BOUND_SUFFIX = '￿';

export type UsernamePrefixRange = { $gte: string; $lt: string };

/**
 * `null` for an empty keyword: the caller omits the condition, so every username
 * qualifies. The prefix is used as typed — case folding is the collation's job.
 */
export const buildUsernamePrefixRange = (
  prefix: string,
): UsernamePrefixRange | null => {
  if (prefix === '') {
    return null;
  }

  return { $gte: prefix, $lt: `${prefix}${UPPER_BOUND_SUFFIX}` };
};
