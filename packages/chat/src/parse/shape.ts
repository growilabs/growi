// Hand-written shape-checking primitives (Requirement 10.1 / task 6.1).
//
// This package cannot add a validation library dependency (see design.md
// "Allowed Dependencies" -- the only runtime deps allowed are
// `structured-headers`, scoped to a single file, and `node:crypto` in
// `src/signature/`), because `@growi/chat` ships into both GROWI and the
// proxy, and any new dependency here lands in both. Tasks 6.2-6.5 build 19
// parse* functions on top of these four primitives, so this file must be
// the complete toolbox they need -- nothing more, nothing less.
//
// A body that passed RFC 9421 signature verification is only proven
// "not tampered with in transit" -- signature verification says nothing
// about the body's SIZE. That is why every primitive that reads a string
// or an array takes an explicit max-length / max-count parameter: there is
// no variant here that reads an unbounded string or array. A holder of a
// valid key (e.g. a legitimately paired peer that gets compromised) could
// otherwise stall the receiving side with an oversized body.

/**
 * True when `v` is a plain object -- not `null`, and not an array.
 *
 * `typeof` alone cannot tell an array from a plain object (both report
 * `'object'`), so the explicit `!Array.isArray` check is load-bearing, not
 * decorative.
 */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Narrows `v` to `string` when it is non-empty and no longer than `max`.
 *
 * Non-emptiness is enforced unconditionally. This is NOT because every
 * downstream string field is guaranteed non-empty in practice -- e.g.
 * `CommandRequest`'s `createPage` variant (`contract/command.ts`) has a
 * `body` field where an empty page body is a legitimate value in GROWI.
 * A field where blank is legitimate must NOT be routed through `str` --
 * the caller checks for the key's presence/type itself instead. `str`'s
 * contract is narrower and simpler: "a non-empty string bounded by `max`",
 * which covers the common case (ids, names, non-blank bodies) without a
 * parameter every caller would otherwise have to thread through.
 */
export const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined;

/**
 * Narrows `v` to a `ReadonlyArray<T>` when it is an array of at most `max`
 * items and EVERY item passes `item`.
 *
 * This is all-or-nothing on purpose: every parse function in this package
 * returns either the fully-typed value or an error variant, never a
 * partially-valid value (design.md's parse* functions never expose a
 * "some items were dropped" shape). Rejecting the whole array the moment
 * one element fails keeps that invariant -- a caller that let malformed
 * items silently disappear would have to reason about a list whose length
 * no longer matches the sender's intent.
 *
 * An empty array is valid: a list with zero items is a legitimate answer
 * to "how many of X are there". Requiring at least one item is a rule for
 * a specific field, not for `arr` itself.
 */
export const arr = <T>(
  v: unknown,
  max: number,
  item: (x: unknown) => T | undefined,
): ReadonlyArray<T> | undefined => {
  if (!Array.isArray(v) || v.length > max) {
    return undefined;
  }

  const narrowed: T[] = [];
  for (const element of v) {
    const parsed = item(element);
    if (parsed === undefined) {
      return undefined;
    }
    narrowed.push(parsed);
  }

  return narrowed;
};

/**
 * Narrows `v` to one of the literal values in `allowed` on an exact match.
 *
 * No coercion: `v` must already be one of the exact runtime values in
 * `allowed` (e.g. `oneOf(1, ['1', '2'])` is `undefined`, not `'1'`) --
 * treating a same-looking value of a different type as a match would let a
 * sender smuggle a type mismatch past this check.
 */
export const oneOf = <T extends string>(
  v: unknown,
  allowed: ReadonlyArray<T>,
): T | undefined =>
  typeof v === 'string' && (allowed as ReadonlyArray<string>).includes(v)
    ? (v as T)
    : undefined;
