import { isRecord } from './is-record';

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
  if (!isRecord(value)) {
    return false;
  }
  // Each top-level entry must itself be a (non-array) option object.
  return Object.values(value).every((v) => isRecord(v));
};

/**
 * The classification of a providerOptions textarea value, used to drive the inline
 * status indicator (valid / invalid + why + where).
 *
 * `empty` is reported separately from `valid` so the UI can stay neutral for an
 * unset value (no "valid JSON" affirmation for an empty field). `syntax-error`
 * carries a 1-based line/column so the admin can locate the typo; `shape-error`
 * is well-formed JSON of the wrong shape (not a provider-namespaced object), for
 * which there is no single offending position.
 */
export type ProviderOptionsJsonStatus =
  | { kind: 'empty' }
  | { kind: 'valid' }
  | { kind: 'syntax-error'; line: number; column: number }
  | { kind: 'shape-error' };

/**
 * Locate a `JSON.parse` syntax error in the source text. V8's `SyntaxError`
 * message carries a `... at position N` byte offset (newer engines also append
 * `(line L column C)`); deriving line/column from N against the source keeps the
 * result stable across Node versions. Falls back to the start of the input when
 * no position can be parsed.
 *
 * In-process V8 only (never sent to MongoDB), so a plain `RegExp` is fine here
 * — see `.claude/rules/mongodb-regex.md`.
 */
const locateSyntaxError = (
  text: string,
  error: unknown,
): { line: number; column: number } => {
  const message = error instanceof Error ? error.message : String(error);
  const match = /position (\d+)/.exec(message);
  if (match == null) {
    return { line: 1, column: 1 };
  }
  const position = Number(match[1]);
  const before = text.slice(0, position);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    // column is 1-based: chars after the last newline, or from the start.
    column: position - lastNewline,
  };
};

/**
 * Classify a providerOptions textarea value for inline feedback: the single
 * parse-and-check pipeline. The FE/BE validator `isValidProviderOptionsJson` is
 * derived from this (valid iff `empty` or `valid`), so the on-screen indicator and
 * the rule that actually blocks save can never disagree on the valid/invalid split;
 * this function additionally reports the *why* (syntax vs. shape) and the
 * syntax-error location, which the validator does not need.
 */
export const getProviderOptionsJsonStatus = (
  value: string,
): ProviderOptionsJsonStatus => {
  if (value.trim() === '') {
    return { kind: 'empty' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    return { kind: 'syntax-error', ...locateSyntaxError(value, error) };
  }
  return isProviderNamespacedObject(parsed)
    ? { kind: 'valid' }
    : { kind: 'shape-error' };
};

/**
 * Shared FE/BE formal validation for the `ai:providerOptions` raw JSON string
 * (R6.2). The source of truth for both the client form (react-hook-form `validate`
 * rule) and the server route (express-validator `.custom`), so client and server
 * accept/reject exactly the same input — and it matches what the runtime resolver
 * applies, so a value that passes here is never accepted on save but then silently
 * ignored at chat time.
 *
 * Derived from `getProviderOptionsJsonStatus` so the valid/invalid split has ONE
 * definition: valid iff the value is empty or a provider-namespaced object; a
 * syntax error, a wrong-shape value (bare primitive / array / non-namespaced
 * object), etc. are all invalid. `{}` is valid (vacuously).
 */
export const isValidProviderOptionsJson = (value: string): boolean => {
  const { kind } = getProviderOptionsJsonStatus(value);
  return kind === 'empty' || kind === 'valid';
};
