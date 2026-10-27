import { isRecord } from './is-record';

describe('isRecord', () => {
  it('accepts a plain object', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('rejects null and undefined', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });

  it('rejects an array (the case an inline `typeof === object` check would miss)', () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord(['a'])).toBe(false);
  });

  it('rejects primitives', () => {
    expect(isRecord('x')).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});
