import { escapeStringForMongoRegex } from '@growi/core/dist/utils';

/**
 * Escaped, prefix-anchored, case-insensitive regex query value for username matching.
 * Used by User's username queries only. Activity's snapshot-username regex stages
 * (activity.ts) build their own pattern independently and do not share this helper --
 * `WithTotalCount` in particular stays substring-matched on purpose, so results merged
 * via isIncludeMixedUsernames are not semantically consistent across sources.
 */
export const buildUsernamePrefixRegexQuery = (
  username: string,
): { $regex: string; $options: string } => ({
  $regex: `^${escapeStringForMongoRegex(username)}`,
  $options: 'i',
});
