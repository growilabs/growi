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

/**
 * Returns `after` with any leaf that exists in `before` but is missing from
 * `after` added back (using `before`'s own value), whenever that leaf still
 * exists in `sourceLanguageContent` (en_US, the source language).
 *
 * `classify`/`mergeTranslations` cannot themselves tell "the translator
 * genuinely deleted this key" apart from "POEditor's export for this
 * language just hasn't caught up with a key en_US still declares" -- both
 * look identical as "missing from `after`". Feeding `classify` and
 * `mergeTranslations` this function's output instead of the raw POEditor
 * export folds that distinction in up front: a key still declared in en_US
 * is left unchanged rather than proposed for removal, so a lagging POEditor
 * export can never turn into a proposed deletion of a key the source
 * language still has (see PR #11935, where `ai_sidebar.sources_one` /
 * `ai_sidebar.sources_other` were nearly deleted from `fr_FR` this way even
 * though `en_US` -- and the code that reads them -- still had them).
 *
 * A leaf missing from both `after` and `sourceLanguageContent` is left
 * missing: that is a genuine removal (the key is gone from the source
 * language too), which `classify` must still report.
 */
export const restoreKeysStillInSource = (
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  sourceLanguageContent: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const afterLeaves = flattenToLeafPaths(after);
  const sourceLeaves = flattenToLeafPaths(sourceLanguageContent);

  const walk = (
    beforeObj: Readonly<Record<string, unknown>>,
    afterObj: Readonly<Record<string, unknown>>,
    prefix: string,
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = { ...afterObj };

    for (const [key, beforeValue] of Object.entries(beforeObj)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;

      if (isPlainObject(beforeValue)) {
        const afterNested = isPlainObject(afterObj[key])
          ? (afterObj[key] as Record<string, unknown>)
          : {};
        const merged = walk(beforeValue, afterNested, path);
        if (Object.keys(merged).length > 0) {
          result[key] = merged;
        }
        continue;
      }

      if (afterLeaves.has(path) || !sourceLeaves.has(path)) {
        continue;
      }

      result[key] = beforeValue;
    }

    return result;
  };

  return walk(before, after, '');
};

/**
 * Keeps only the leaves of `candidate` whose full path also exists as a
 * leaf in `reference`, recursively -- e.g. filtering a non-source
 * language's file down to the key set `en_US` actually declares (see
 * research.md's `sync_terms`-addition Decision).
 */
export const filterToKnownKeys = (
  reference: Readonly<Record<string, unknown>>,
  candidate: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const referenceLeaves = flattenToLeafPaths(reference);

  const walk = (
    obj: Readonly<Record<string, unknown>>,
    prefix: string,
  ): Record<string, unknown> => {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix === '' ? key : `${prefix}.${key}`;

      if (isPlainObject(value)) {
        const nested = walk(value, path);
        if (Object.keys(nested).length > 0) {
          result[key] = nested;
        }
        continue;
      }

      if (referenceLeaves.has(path)) {
        result[key] = value;
      }
    }

    return result;
  };

  return walk(candidate, '');
};
