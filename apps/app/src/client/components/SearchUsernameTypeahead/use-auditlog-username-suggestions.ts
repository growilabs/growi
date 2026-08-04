import { useSWRxAuditlogSuggestions } from '~/stores/activity';

import type { UsernameSuggestions } from './username-suggestions';

/**
 * Admin-only suggestion source, backed by `/activity/suggestions`
 * (`adminRequired`). It suggests the usernames that actually appear in recorded
 * activities — including operators who no longer exist as users — which is what
 * an audit-log filter needs, and is why it is not usable outside the admin pages.
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
    // A failed request must not leave the typeahead spinning: SWR keeps
    // `isLoading` true while it retries.
    isLoading: isLoading === true && error == null,
  };
};
