import { useSWRxUsernames } from '~/stores/user';

import type { UsernameSuggestions } from './username-suggestions';
import { toUsernameSuggestions } from './username-suggestions';

/**
 * Source for callers outside the admin pages, backed by `/users/usernames`
 * (`loginRequired`).
 *
 * Suggests only registered users; historical names that exist merely as activity
 * operators are unreachable — the trade-off for being available to non-admins.
 */
export const useRegisteredUsernameSuggestions = (
  keyword: string,
): UsernameSuggestions => {
  const { data, error, isLoading } = useSWRxUsernames(keyword);

  return toUsernameSuggestions({
    activeUsernames: data?.activeUser?.usernames,
    inactiveUsernames: data?.inactiveUser?.usernames,
    error,
    isLoading,
  });
};
