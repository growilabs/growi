import { describe, expect, it } from 'vitest';

import { compareIso, daysBetween, minusSeconds } from './time.ts';

describe('time.compareIso', () => {
  it('orders two timestamps chronologically', () => {
    expect(compareIso('2026-09-14T12:12:24Z', '2026-09-14T12:12:25Z')).toBe(-1);
    expect(compareIso('2026-09-14T12:12:25Z', '2026-09-14T12:12:24Z')).toBe(1);
  });

  it('treats the same instant as equal even when the precision differs', () => {
    expect(compareIso('2026-09-14T12:12:24Z', '2026-09-14T12:12:24.000Z')).toBe(
      0,
    );
  });

  it('compares sub-second parts', () => {
    expect(
      compareIso('2026-09-14T12:12:24.001Z', '2026-09-14T12:12:24.002Z'),
    ).toBe(-1);
  });

  it.each([
    ['empty string', ''],
    ['date only', '2026-09-16'],
    ['local offset instead of UTC', '2026-09-16T00:00:00+09:00'],
    ['no zone designator', '2026-09-16T00:00:00'],
    ['not a timestamp at all', 'yesterday'],
    ['impossible month', '2026-13-01T00:00:00Z'],
  ])('throws on %s', (_name, value) => {
    // `date -d ""` silently resolved to today at midnight; this must not.
    expect(() => compareIso(value, '2026-09-14T12:12:24Z')).toThrow();
    expect(() => compareIso('2026-09-14T12:12:24Z', value)).toThrow();
  });
});

describe('time.minusSeconds', () => {
  it('subtracts the pause window and keeps second precision', () => {
    // Second precision matters: the result is compared as a string against
    // GitHub `created_at` values, which are fixed-width to the second.
    expect(minusSeconds('2026-09-14T12:12:24Z', 120)).toBe(
      '2026-09-14T12:10:24Z',
    );
  });

  it('never emits milliseconds, even for a sub-second input', () => {
    expect(minusSeconds('2026-09-14T12:12:24.750Z', 120)).toBe(
      '2026-09-14T12:10:24Z',
    );
  });

  it('crosses a day boundary correctly', () => {
    expect(minusSeconds('2026-09-15T00:00:30Z', 120)).toBe(
      '2026-09-14T23:58:30Z',
    );
  });

  it('accepts a negative number of seconds as an addition', () => {
    expect(minusSeconds('2026-09-14T12:12:24Z', -60)).toBe(
      '2026-09-14T12:13:24Z',
    );
  });

  it('throws on a malformed timestamp', () => {
    expect(() => minusSeconds('', 120)).toThrow();
    expect(() => minusSeconds('2026-09-16', 120)).toThrow();
  });

  it('throws when the number of seconds is not a finite integer', () => {
    expect(() => minusSeconds('2026-09-14T12:12:24Z', Number.NaN)).toThrow();
    expect(() => minusSeconds('2026-09-14T12:12:24Z', 1.5)).toThrow();
  });
});

describe('time.daysBetween', () => {
  it('counts whole elapsed days', () => {
    expect(daysBetween('2026-09-01T00:00:00Z', '2026-09-15T12:00:00Z')).toBe(
      14,
    );
  });

  it('returns 0 for less than one full day', () => {
    expect(daysBetween('2026-09-01T00:00:00Z', '2026-09-01T23:59:59Z')).toBe(0);
  });

  it('is negative when the second timestamp is older', () => {
    expect(daysBetween('2026-09-15T12:00:00Z', '2026-09-01T00:00:00Z')).toBe(
      -14,
    );
  });

  it('throws on a malformed timestamp instead of measuring from today', () => {
    expect(() => daysBetween('', '2026-09-15T12:00:00Z')).toThrow();
    expect(() => daysBetween('2026-09-15T12:00:00Z', '')).toThrow();
  });
});
