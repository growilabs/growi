import { isProviderNamespacedObject } from '../../utils/provider-options-validation';

/**
 * The classification of a providerOptions textarea value, used to drive the
 * inline status indicator (valid / invalid + why + where).
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
 * Classify the providerOptions textarea value for inline feedback.
 *
 * Agrees with the shared FE/BE validator `isValidProviderOptionsJson` on the
 * valid/invalid split (empty + provider-namespaced object = ok), but adds the
 * *why* (syntax vs. shape) and the syntax-error location. The shared validator
 * remains the single source of truth for the react-hook-form `validate` rule
 * that actually blocks save; this only drives the on-screen indicator.
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
