export type UsernameSuggestions = {
  activeUsernames: string[];
  inactiveUsernames: string[];
  isLoading: boolean;
};

/**
 * The suggestion source injected into `SearchUsernameTypeahead`.
 *
 * Injected rather than hard-coded because the available endpoints differ in the
 * privilege they demand, so any single default 403s for some callers.
 *
 * Invoked as a hook, so a given instance must receive a **stable** reference (a
 * module-scope hook, not an inline closure): React keys hook state by call
 * order, and swapping the function between renders reorders the hooks it calls.
 */
export type UseUsernameSuggestions = (keyword: string) => UsernameSuggestions;
