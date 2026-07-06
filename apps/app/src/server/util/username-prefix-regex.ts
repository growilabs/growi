import { escapeStringForMongoRegex } from '@growi/core/dist/utils';

/**
 * Escaped, prefix-anchored, case-insensitive regex query value for username matching.
 * User and Activity must share these semantics because the /users/usernames route's
 * isIncludeMixedUsernames option merges results from both models.
 */
export const buildUsernamePrefixRegexQuery = (
  username: string,
): { $regex: string; $options: string } => ({
  $regex: `^${escapeStringForMongoRegex(username)}`,
  $options: 'i',
});
