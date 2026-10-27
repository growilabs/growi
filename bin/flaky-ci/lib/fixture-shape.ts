/**
 * Computing the "shape" of a JSON value and diffing two shapes.
 *
 * A fixture's real value (comment bodies, timestamps, label state, ...) is
 * expected to drift over time and is not interesting to this feature
 * (Requirement 1.3). What *is* interesting is whether the top-level field
 * construction of a GitHub API response has changed since the fixture was
 * captured (Requirement 1.2) — a key was added/removed, or a value's type
 * changed underneath the same key.
 *
 * `computeShape` throws away every value and keeps only the structural
 * skeleton: for objects, the set of keys and each key's own shape
 * (recursive); for arrays, the shape of the first element only — an array's
 * *element count* is a value-level fact, not a structural one, so two
 * arrays of the same element type but different lengths must compute to the
 * same shape (design.md fixture-shape.ts contract). Primitives keep only
 * their type name, never their value.
 *
 * `diffShapes` then walks two shapes together and returns the key paths
 * where they disagree (added key, removed key, or same key with a
 * different type). `diffShapes(a, a)` is always `[]` by construction: no
 * path is ever emitted for two structurally identical shapes.
 */

export type Shape =
  | { readonly type: 'string' | 'number' | 'boolean' | 'null' }
  | { readonly type: 'array'; readonly element: Shape | null }
  | {
      readonly type: 'object';
      readonly fields: Readonly<Record<string, Shape>>;
    };

/**
 * Computes the shape of an arbitrary JSON value. `value` is expected to be
 * something `JSON.parse` produced (string / number / boolean / null /
 * array / object), but the parameter is `unknown` per the Service
 * Interface contract, so any other JS runtime value (e.g. `undefined`)
 * degrades to `{ type: 'null' }` rather than throwing — this function never
 * throws (design.md Postconditions).
 */
export const computeShape = (value: unknown): Shape => {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      element: value.length === 0 ? null : computeShape(value[0]),
    };
  }
  if (value === null) {
    return { type: 'null' };
  }
  if (typeof value === 'string') {
    return { type: 'string' };
  }
  if (typeof value === 'number') {
    return { type: 'number' };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  if (typeof value === 'object') {
    const fields: Record<string, Shape> = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      fields[key] = computeShape(fieldValue);
    }
    return { type: 'object', fields };
  }
  // Non-JSON JS values (undefined, function, symbol, bigint) never appear
  // in a value that came from JSON.parse; treat them as 'null' rather than
  // throwing, consistent with "never throws".
  return { type: 'null' };
};

const joinPath = (parentPath: string, key: string): string =>
  parentPath === '' ? key : `${parentPath}.${key}`;

/**
 * Reports the key paths where two shapes disagree: a key present on only
 * one side, or a key present on both sides with a different `type`. A
 * changed array element count is never reported, because `computeShape`
 * already discarded that information — only a genuine element *type*
 * change (itself walked recursively) surfaces here.
 */
export const diffShapes = (
  a: Shape,
  b: Shape,
  path = '',
): readonly string[] => {
  if (a.type !== b.type) {
    return [path === '' ? '(root)' : path];
  }

  if (a.type === 'object' && b.type === 'object') {
    const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
    const diffs: string[] = [];
    for (const key of keys) {
      const childPath = joinPath(path, key);
      const aField = a.fields[key];
      const bField = b.fields[key];
      if (aField === undefined || bField === undefined) {
        diffs.push(childPath);
        continue;
      }
      diffs.push(...diffShapes(aField, bField, childPath));
    }
    return diffs;
  }

  if (a.type === 'array' && b.type === 'array') {
    if (a.element === null || b.element === null) {
      // One or both sides are empty arrays; with no element to compare,
      // there is nothing structural to report (empty-vs-nonempty is an
      // element-count fact, same as any other length difference).
      return [];
    }
    return diffShapes(a.element, b.element, path);
  }

  // Same primitive `type` on both sides ('string' | 'number' | 'boolean' | 'null').
  return [];
};
