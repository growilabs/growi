import { describe, expect, it } from 'vitest';

import { parseTimeRange, TIME_RANGE_USAGE } from './time-range.js';

describe('parseTimeRange', () => {
  it('reads a start and an end separated by two dots', () => {
    expect(parseTimeRange('2026-09-01..2026-09-03')).toEqual({
      since: new Date('2026-09-01T00:00:00.000Z'),
      until: new Date('2026-09-03T00:00:00.000Z'),
    });
  });

  it('reads a single day as that whole day', () => {
    expect(parseTimeRange('2026-09-01')).toEqual({
      since: new Date('2026-09-01T00:00:00.000Z'),
      until: new Date('2026-09-02T00:00:00.000Z'),
    });
  });

  it('keeps the time of day when one is written out', () => {
    expect(
      parseTimeRange('2026-09-01T09:00:00Z..2026-09-01T18:30:00Z'),
    ).toEqual({
      since: new Date('2026-09-01T09:00:00.000Z'),
      until: new Date('2026-09-01T18:30:00.000Z'),
    });
  });

  it.each([
    // Task 4.4's hand-off (b-2): the command line hands `range` the FIRST word
    // only, so a range written with spaces silently loses its tail. Refusing
    // anything this parser cannot consume whole is what turns that into a
    // visible refusal instead of an import of the wrong days.
    ['2026-09-01 to 2026-09-03'],
    ['2026-09-01..'],
    ['..2026-09-03'],
    ['yesterday'],
    [''],
    // Backwards: an empty span would silently import nothing.
    ['2026-09-03..2026-09-01'],
    // Same instant on both sides: also an empty span.
    ['2026-09-01T09:00:00Z..2026-09-01T09:00:00Z'],
  ])('refuses %s', (text) => {
    expect(parseTimeRange(text)).toBeNull();
  });

  it('publishes the wording a caller shows when it refuses', () => {
    expect(TIME_RANGE_USAGE).toContain('..');
  });
});
