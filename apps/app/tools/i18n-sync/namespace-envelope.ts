/**
 * Wraps/unwraps namespace-shaped JSON for the shared POEditor project.
 *
 * Pure functions, no I/O — reading locale files and calling POEditor is
 * `PushSourceSync`/`PullTranslationSync`'s responsibility, not this module's.
 */

export interface NamespaceContentEntry {
  readonly namespace: string;
  readonly content: Readonly<Record<string, unknown>>;
}

/**
 * Combines multiple namespaces' contents into a single JSON keyed by
 * namespace name (used for the push workflow's one-shot converge upload).
 *
 * Precondition: `entries` must not contain duplicate `namespace` values —
 * enforcing that is the caller's responsibility, not this function's.
 */
export const combineNamespaceContents = (
  entries: readonly NamespaceContentEntry[],
): Record<string, unknown> => {
  const combined: Record<string, unknown> = {};

  for (const entry of entries) {
    combined[entry.namespace] = entry.content;
  }

  return combined;
};

/**
 * Wraps a single namespace's content under its namespace name as the sole
 * key (used for the push workflow's per-namespace tagging upload).
 */
export const wrapSingleNamespace = (
  namespace: string,
  content: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  return { [namespace]: content };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Extracts one namespace's content out of a combined JSON (used to split a
 * per-language POEditor export back into namespaces for the pull workflow).
 *
 * Returns an empty object — never throws — when the target namespace's key
 * is absent or its value is not an object, which means POEditor does not
 * yet hold any content for that namespace.
 */
export const extractNamespaceContent = (
  combined: Readonly<Record<string, unknown>>,
  namespace: string,
): Record<string, unknown> => {
  const value = combined[namespace];

  if (!isPlainObject(value)) {
    return {};
  }

  return value;
};
