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
