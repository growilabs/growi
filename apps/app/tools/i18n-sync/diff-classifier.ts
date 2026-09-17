/**
 * Compares a locale namespace's leaf key paths before/after a POEditor
 * export and classifies the change as one of `no_change` /
 * `translation_only` / `structural`.
 *
 * Pure function, no I/O — reading files and calling POEditor is
 * `PullTranslationSync`'s responsibility, not this module's.
 */

export type ClassificationResult =
  | { readonly kind: 'no_change' }
  | {
      readonly kind: 'translation_only';
      readonly changedKeys: readonly string[];
    }
  | {
      readonly kind: 'structural';
      readonly addedKeys: readonly string[];
      readonly removedKeys: readonly string[];
    };

export interface DiffClassifierInput {
  /** The JSON currently committed in the repository. */
  readonly before: Readonly<Record<string, unknown>>;
  /** The JSON exported from POEditor. */
  readonly after: Readonly<Record<string, unknown>>;
}

/**
 * Flattens a nested locale object into a map of leaf key path (e.g.
 * "a.b.c") -> leaf value. Only plain objects are descended into; any other
 * value (string, number, array, etc.) is treated as a leaf, matching how
 * i18next locale JSON files are structured (nested namespaces of strings).
 */
const flattenToLeafPaths = (
  obj: Readonly<Record<string, unknown>>,
  prefix = '',
): Map<string, unknown> => {
  const result = new Map<string, unknown>();

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;

    if (isPlainObject(value)) {
      for (const [nestedPath, nestedValue] of flattenToLeafPaths(value, path)) {
        result.set(nestedPath, nestedValue);
      }
      continue;
    }

    result.set(path, value);
  }

  return result;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Compares the leaf key sets of `before`/`after` and classifies the change.
 * `before`/`after` must be the same namespace/language's JSON.
 */
export const classify = (input: DiffClassifierInput): ClassificationResult => {
  const beforeLeaves = flattenToLeafPaths(input.before);
  const afterLeaves = flattenToLeafPaths(input.after);

  const addedKeys: string[] = [];
  const removedKeys: string[] = [];
  const changedKeys: string[] = [];

  for (const [path, afterValue] of afterLeaves) {
    // '' means "not yet translated in POEditor", never a real value (see
    // research.md's fallback-language Decision).
    if (afterValue === '') {
      continue;
    }

    if (!beforeLeaves.has(path)) {
      addedKeys.push(path);
      continue;
    }

    const beforeValue = beforeLeaves.get(path);
    if (beforeValue !== afterValue) {
      changedKeys.push(path);
    }
  }

  for (const path of beforeLeaves.keys()) {
    if (!afterLeaves.has(path)) {
      removedKeys.push(path);
    }
  }

  if (addedKeys.length > 0 || removedKeys.length > 0) {
    return { kind: 'structural', addedKeys, removedKeys };
  }

  if (changedKeys.length > 0) {
    return { kind: 'translation_only', changedKeys };
  }

  return { kind: 'no_change' };
};

/**
 * The write-side counterpart to `classify`'s read-side skip rule: `before`
 * with `after`'s non-empty leaves applied over it, recursively. Writing the
 * raw `after` export instead would blank existing translations wherever a
 * term is still untranslated (see research.md's fallback-language Decision).
 *
 * A newly-added nested object whose every leaf is `''` is omitted rather
 * than kept as `{}`, so it never changes the key set without a matching
 * entry in `classify`'s `addedKeys`.
 */
export const mergeTranslations = (
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, afterValue] of Object.entries(after)) {
    if (isPlainObject(afterValue)) {
      const beforeValue = before[key];
      const mergedNested = mergeTranslations(
        isPlainObject(beforeValue) ? beforeValue : {},
        afterValue,
      );
      if (!(key in before) && Object.keys(mergedNested).length === 0) {
        continue;
      }
      result[key] = mergedNested;
      continue;
    }

    if (afterValue === '') {
      if (key in before) {
        result[key] = before[key];
      }
      continue;
    }

    result[key] = afterValue;
  }

  return result;
};
