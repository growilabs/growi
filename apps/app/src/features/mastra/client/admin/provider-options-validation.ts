/**
 * Client-side formal validation for the `ai:providerOptions` raw JSON string.
 *
 * This mirrors the server-side check (R6.2) and only verifies that a non-empty
 * value is parseable JSON; the semantic validity of the options is the
 * responsibility of each provider integration, not this form.
 *
 * An empty (or whitespace-only) value is treated as valid: it represents "no
 * provider options", which the container normalizes to `undefined` on save.
 */
export const isValidProviderOptionsJson = (value: string): boolean => {
  if (value.trim() === '') {
    return true;
  }
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
};
