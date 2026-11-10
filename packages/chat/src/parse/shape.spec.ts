import { describe, expect, it } from 'vitest';

import { arr, isRecord, oneOf, str } from './shape.js';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  // The naive `typeof v === 'object'` check alone would wrongly accept an
  // array -- this is the case the explicit `!Array.isArray` guard exists for.
  it('rejects an array even though typeof array === "object"', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2, 3])).toBe(false);
  });

  it('rejects null even though typeof null === "object"', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('rejects primitives', () => {
    expect(isRecord('a string')).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('str', () => {
  it('returns the string when non-empty and within max length', () => {
    expect(str('hello', 10)).toBe('hello');
  });

  it('rejects an empty string', () => {
    expect(str('', 10)).toBeUndefined();
  });

  it('rejects a string exceeding max length', () => {
    expect(str('012345678901', 10)).toBeUndefined();
  });

  it('accepts a string exactly at the max-length boundary', () => {
    expect(str('0123456789', 10)).toBe('0123456789');
  });

  it('rejects non-string values', () => {
    expect(str(123, 10)).toBeUndefined();
    expect(str({}, 10)).toBeUndefined();
    expect(str([], 10)).toBeUndefined();
    expect(str(null, 10)).toBeUndefined();
    expect(str(undefined, 10)).toBeUndefined();
  });

  // Acceptance criterion: callers must be able to attach a real length cap --
  // the same long input is rejected at a small max and accepted at a large one.
  it('genuinely enforces the max parameter (same input, different max)', () => {
    const longValue = 'x'.repeat(500);

    expect(str(longValue, 10)).toBeUndefined();
    expect(str(longValue, 1000)).toBe(longValue);
  });
});

describe('arr', () => {
  const asPositiveNumber = (x: unknown): number | undefined =>
    typeof x === 'number' && x > 0 ? x : undefined;

  it('returns the narrowed array when within max count and every item is valid', () => {
    expect(arr([1, 2, 3], 10, asPositiveNumber)).toEqual([1, 2, 3]);
  });

  it('accepts an empty array (zero items is a legitimate list)', () => {
    expect(arr([], 10, asPositiveNumber)).toEqual([]);
  });

  it('rejects an array exceeding max count', () => {
    expect(arr([1, 2, 3, 4], 3, asPositiveNumber)).toBeUndefined();
  });

  // All-or-nothing: one malformed item invalidates the whole array, never a
  // partial result -- parse functions built on this must return either the
  // fully-typed value or an error, never something half-valid.
  it('rejects the whole array when even one item fails the item check', () => {
    expect(arr([1, 2, -1, 4], 10, asPositiveNumber)).toBeUndefined();
  });

  it('rejects non-array values', () => {
    expect(arr('not an array', 10, asPositiveNumber)).toBeUndefined();
    expect(arr({}, 10, asPositiveNumber)).toBeUndefined();
    expect(arr(null, 10, asPositiveNumber)).toBeUndefined();
    expect(arr(undefined, 10, asPositiveNumber)).toBeUndefined();
  });

  // Acceptance criterion: callers must be able to attach a real count cap --
  // the same long array is rejected at a small max and accepted at a large one.
  it('genuinely enforces the max parameter (same input, different max)', () => {
    const longArray = Array.from({ length: 500 }, (_, i) => i + 1);

    expect(arr(longArray, 10, asPositiveNumber)).toBeUndefined();
    expect(arr(longArray, 1000, asPositiveNumber)).toEqual(longArray);
  });
});

describe('oneOf', () => {
  const allowed = ['a', 'b', 'c'] as const;

  it('returns the value narrowed to the literal type when it matches', () => {
    expect(oneOf('b', allowed)).toBe('b');
  });

  it('rejects a value not in the allowed set', () => {
    expect(oneOf('d', allowed)).toBeUndefined();
  });

  // No coercion -- a value of the wrong type that merely looks like an
  // allowed literal (e.g. the number 1 vs. the string '1') must not match.
  it('does not attempt type coercion', () => {
    expect(oneOf(1, ['1', '2'] as const)).toBeUndefined();
  });

  it('rejects non-string values entirely', () => {
    expect(oneOf(null, allowed)).toBeUndefined();
    expect(oneOf(undefined, allowed)).toBeUndefined();
    expect(oneOf({}, allowed)).toBeUndefined();
  });
});
