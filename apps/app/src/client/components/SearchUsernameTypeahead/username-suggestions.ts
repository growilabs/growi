export type UsernameSuggestions = {
  activeUsernames: string[];
  inactiveUsernames: string[];
  isLoading: boolean;
};

/**
 * The suggestion source injected into `SearchUsernameTypeahead`.
 *
 * This component is rendered both on admin pages and on the general search page,
 * whose viewers do not have the same privileges: the audit-log suggestions
 * endpoint is `adminRequired`, so a non-admin caller must supply a source of its
 * own. Injecting the source keeps that decision at the call site instead of
 * hard-coding one endpoint that then 403s for half the callers.
 *
 * Implementations are invoked as React hooks, so a given instance must receive a
 * **stable** reference (a module-scope hook, not an inline closure): React keys
 * hook state by call order, and swapping the function between renders would
 * reorder the hooks it calls internally.
 */
export type UseUsernameSuggestions = (keyword: string) => UsernameSuggestions;
