/**
 * Shared FE/BE formal validation for the `ai:providerOptions` raw JSON string
 * (R6.2). This single predicate is the source of truth for both the client form
 * (react-hook-form `validate` rule) and the server route (express-validator
 * `.custom`), so client and server accept/reject exactly the same input.
 *
 * Contract (JSON.parse based):
 *   - empty / whitespace-only value => valid; it represents "no provider
 *     options", which the container normalizes to `undefined` on save.
 *   - any value `JSON.parse` accepts (objects, arrays, and bare primitives such
 *     as `42` or `"x"`) => valid; the semantic validity of the options is each
 *     provider integration's responsibility, not this form.
 *   - anything else (malformed JSON) => invalid.
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
