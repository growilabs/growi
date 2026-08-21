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

type SuggestionSourceState = {
  activeUsernames?: string[];
  inactiveUsernames?: string[];
  error?: unknown;
  isLoading?: boolean;
};

/**
 * Builds the injected-source contract from an SWR response.
 *
 * Each source reads its two username lists out of a differently-shaped payload
 * but derives `isLoading` identically: SWR keeps it true while it retries, and a
 * failed request must not leave the typeahead spinning forever.
 */
export const toUsernameSuggestions = ({
  activeUsernames,
  inactiveUsernames,
  error,
  isLoading,
}: SuggestionSourceState): UsernameSuggestions => ({
  activeUsernames: activeUsernames ?? [],
  inactiveUsernames: inactiveUsernames ?? [],
  isLoading: isLoading === true && error == null,
});
