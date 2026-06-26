/**
 * True when `value` is a provider-namespaced options object: a non-null, non-array
 * object whose every top-level value is itself a non-null, non-array object — the
 * exact shape the AI SDK's `providerOptions` consumes (e.g. `{ openai: { ... } }`).
 * An empty object `{}` is valid (vacuously: no namespaces). Reused by the admin
 * settings PUT validator (`validate-allowed-models`) so the FE form and server-side
 * persistence agree on what "valid" means — a value that passes here is stored
 * as-is and applied verbatim at chat time, never silently dropped.
 */
export const isProviderNamespacedObject = (value: unknown): boolean => {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    return false;
  }
  // Each top-level entry must itself be a (non-array) option object.
  return Object.values(value).every(
    (v) => typeof v === 'object' && v != null && !Array.isArray(v),
  );
};

/**
 * Shared FE/BE formal validation for the `ai:providerOptions` raw JSON string
 * (R6.2). This single predicate is the source of truth for both the client form
 * (react-hook-form `validate` rule) and the server route (express-validator
 * `.custom`), so client and server accept/reject exactly the same input — and it
 * matches what the runtime resolver actually applies, so a value that passes here
 * is never accepted on save but then silently ignored at chat time.
 *
 * Contract:
 *   - empty / whitespace-only value => valid; it represents "no provider
 *     options", which the container normalizes to `undefined` on save.
 *   - a provider-namespaced JSON object (see `isProviderNamespacedObject`) => valid;
 *     the semantic validity of the per-provider options is each provider
 *     integration's responsibility, not this form. `{}` is valid.
 *   - anything else => invalid: malformed JSON, OR valid JSON of the wrong shape
 *     (a bare primitive such as `42` / `"x"` / `true` / `null`, an array, or an
 *     object whose value is not itself an option object). The runtime ignores
 *     these, so rejecting them up front gives the admin immediate feedback instead
 *     of a silent no-op on save.
 */
export const isValidProviderOptionsJson = (value: string): boolean => {
  if (value.trim() === '') {
    return true;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return isProviderNamespacedObject(parsed);
};
