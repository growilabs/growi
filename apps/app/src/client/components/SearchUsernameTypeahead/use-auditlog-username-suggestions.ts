import { useSWRxAuditlogSuggestions } from '~/stores/activity';

import type { UsernameSuggestions } from './username-suggestions';

/**
 * Admin-only source, backed by `/activity/suggestions` (`adminRequired`).
 *
 * Suggests usernames recorded in activities, including operators who no longer
 * exist as users — what an audit-log filter needs, and why it cannot be used
 * outside the admin pages.
 */
export const useAuditlogUsernameSuggestions = (
  keyword: string,
): UsernameSuggestions => {
  const { data, error, isLoading } = useSWRxAuditlogSuggestions(
    'username',
    keyword,
  );

  return {
    activeUsernames: data?.username?.activeUsernames ?? [],
    inactiveUsernames: data?.username?.inactiveUsernames ?? [],
    // SWR keeps `isLoading` true while it retries; a failed request must not
    // leave the typeahead spinning.
    isLoading: isLoading === true && error == null,
  };
};
