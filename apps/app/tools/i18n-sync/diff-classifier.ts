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
    // POEditor exports an untranslated term as an empty string (once the
    // project's Fallback Language is unset) rather than omitting it. An
    // empty string here means "no translation yet", not "translation is
    // now blank" or "key removed" -- skip it so a run with many
    // still-untranslated terms never overwrites or deletes existing
    // content based on their absence of a translation.
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
 * Produces the nested JSON that should actually be written to the
 * repository after a pull -- `before` with `after`'s real (non-empty)
 * values applied over it, recursively. This is the write-side counterpart
 * to `classify`'s read-side skip rule: `classify` only decides what to
 * *report* (an empty `after` leaf is never a change or an addition), and
 * this function is what makes that decision hold at the byte level too. The
 * raw `after` export must never be written directly -- it can carry empty
 * strings for every not-yet-translated term, which would silently blank
 * existing translations the moment any other key in the same file actually
 * changed (see `research.md`'s "POEditor の未翻訳キーは export の空文字列で判定し、
 * fallback言語には頼らない" Decision for the incident this fixes).
 *
 * - A leaf present in `after` with a non-empty value always wins (new or
 *   changed content).
 * - A leaf present in `after` as `''` keeps `before`'s existing value if
 *   there was one, and is otherwise omitted (nothing to add yet).
 * - A leaf genuinely absent from `after` (not merely empty) is dropped --
 *   this only happens when POEditor's term itself was deleted, matching
 *   `classify`'s `removedKeys`.
 * - A nested object that is brand new in `after` (absent from `before`) but
 *   whose every leaf turned out to be `''` merges down to `{}` and is
 *   omitted entirely, for the same reason a single new-but-empty leaf is:
 *   there is nothing real to add yet. Keeping an empty object would still
 *   change the key set with no corresponding entry in `classify`'s
 *   `addedKeys` -- exactly the mismatch this function exists to prevent.
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
