export type UsernameSuggestions = {
  activeUsernames: string[];
  inactiveUsernames: string[];
  isLoading: boolean;
};

/**
 * The suggestion source injected into `UsernameTypeahead`.
 *
 * Injected rather than hard-coded because the available endpoints differ in the
 * privilege they demand, so any single default 403s for some callers.
 *
 * Called during render, so it must obey the rules of hooks. A fresh inline
 * wrapper — `(keyword) => useMySource(keyword)` — is *not* a problem: React
 * keys hook state by call order, not by function identity. What breaks is
 * changing **which** source a given instance calls between renders, e.g.
 * `isAdmin ? useAuditLogUsernameSuggestions : useRegisteredUsernameSuggestions`
 * — the hooks called underneath then change order and React throws.
 *
 * This is why the prop is not part of the public surface: each screen has a
 * wrapper component that hard-codes its own source, so no call site is in a
 * position to swap one.
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
