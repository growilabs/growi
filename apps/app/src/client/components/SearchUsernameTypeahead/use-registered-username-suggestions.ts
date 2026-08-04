import { useSWRxUsernames } from '~/stores/user';

import type { UsernameSuggestions } from './username-suggestions';

/**
 * Suggestion source for callers outside the admin pages, backed by
 * `/users/usernames` (`loginRequired`). It suggests only users registered in this
 * GROWI — it cannot surface historical names that exist merely as recorded
 * activity operators, which is the trade-off for being available to non-admins.
 */
export const useRegisteredUsernameSuggestions = (
  keyword: string,
): UsernameSuggestions => {
  const { data, error, isLoading } = useSWRxUsernames(keyword);

  return {
    activeUsernames: data?.activeUser?.usernames ?? [],
    inactiveUsernames: data?.inactiveUser?.usernames ?? [],
    // A failed request must not leave the typeahead spinning: SWR keeps
    // `isLoading` true while it retries.
    isLoading: isLoading === true && error == null,
  };
};
