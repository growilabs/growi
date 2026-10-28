import { isDeepEquals } from './is-deep-equals.js';

describe('isDeepEquals', () => {
  it('distinguishes different keys whose values are undefined', () => {
    expect(isDeepEquals({ a: undefined }, { b: undefined })).toBe(false);
  });

  it('distinguishes different keys in nested objects', () => {
    expect(
      isDeepEquals({ config: { a: undefined } }, { config: { b: undefined } }),
    ).toBe(false);
  });

  it('distinguishes different keys in array elements', () => {
    expect(isDeepEquals([{ a: undefined }], [{ b: undefined }])).toBe(false);
  });

  it('does not substitute an inherited property for an own property', () => {
    expect(
      isDeepEquals(
        { toString: Object.prototype.toString },
        { other: undefined },
      ),
    ).toBe(false);
  });

  it('rejects a prototype-only key even when own key counts match', () => {
    const first = { a: undefined };
    const second: { b: undefined } = Object.create(
      { a: undefined },
      { b: { value: undefined, enumerable: true } },
    );

    expect(Object.keys(first)).toEqual(['a']);
    expect(Object.keys(second)).toEqual(['b']);
    expect('a' in second).toBe(true);
    expect(isDeepEquals<object>(first, second)).toBe(false);
    expect(isDeepEquals<object>(second, first)).toBe(false);
  });

  // These cases characterize existing behavior; this fix only changes key ownership checks.
  describe('existing comparison semantics', () => {
    it('distinguishes a shared reference from separate equal objects', () => {
      const shared = { x: 1 };
      const first = { a: shared, b: shared };
      const second = { a: { x: 1 }, b: { x: 1 } };

      expect(isDeepEquals(first, second)).toBe(false);
      // The visited map currently tracks references from the first argument only.
      expect(isDeepEquals(second, first)).toBe(true);
    });

    it('distinguishes a top-level array hole from an explicit undefined element', () => {
      const sparse = new Array<number | undefined>(1);

      expect(isDeepEquals(sparse, [undefined])).toBe(false);
      expect(isDeepEquals([undefined], sparse)).toBe(false);
    });

    it('skips holes when comparing nested arrays', () => {
      const sparse = new Array<number | undefined>(1);

      expect(isDeepEquals({ values: sparse }, { values: [undefined] })).toBe(
        true,
      );
      expect(isDeepEquals({ values: [undefined] }, { values: sparse })).toBe(
        true,
      );
    });

    it('compares NaN values as unequal', () => {
      expect(isDeepEquals({ value: Number.NaN }, { value: Number.NaN })).toBe(
        false,
      );
      expect(isDeepEquals([Number.NaN], [Number.NaN])).toBe(false);
    });

    it('compares arrays and plain objects with matching indexed keys as equal', () => {
      expect(isDeepEquals<object>({ 0: 1 }, [1])).toBe(true);
      expect(isDeepEquals<object>([1], { 0: 1 })).toBe(true);
    });
  });

  it('compares equal objects regardless of key order', () => {
    expect(isDeepEquals({ a: undefined, b: 1 }, { b: 1, a: undefined })).toBe(
      true,
    );
  });

  it('compares nested objects and arrays by value', () => {
    expect(
      isDeepEquals(
        { config: { enabled: true }, values: [1, { a: undefined }] },
        { config: { enabled: true }, values: [1, { a: undefined }] },
      ),
    ).toBe(true);
  });

  it('distinguishes different values', () => {
    expect(isDeepEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('distinguishes different numbers of keys', () => {
    expect(isDeepEquals({ a: undefined }, {})).toBe(false);
  });

  it('compares circular references without recursing indefinitely', () => {
    const first: { value: number; self?: object } = { value: 1 };
    const second: { value: number; self?: object } = { value: 1 };
    first.self = first;
    second.self = second;

    expect(isDeepEquals(first, second)).toBe(true);
  });
});
