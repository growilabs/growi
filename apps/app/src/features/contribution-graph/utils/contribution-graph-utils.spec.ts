import {
  getCurrentWeekStart,
  getDaysDifference,
  getISOWeekId,
} from './contribution-graph-utils';

describe('Date Utility Functions (date-fns refactor)', () => {
  describe('getISOWeekId', () => {
    test('should return the correct ISO Week ID for a standard mid-year date (2025-W32)', () => {
      // 2025-08-05 is a Tuesday in Week 32
      const date = new Date('2025-08-05T12:00:00Z');
      expect(getISOWeekId(date)).toBe('2025-W32');
    });

    test('should handle year boundary: Start of year 2025 (falls in Week 1 of 2025)', () => {
      // 2025-01-01 is a Wednesday, falls in the first ISO week of 2025.
      const date = new Date('2025-01-01T12:00:00Z');
      expect(getISOWeekId(date)).toBe('2025-W01');
    });

    test('should handle year boundary: End of year 2024 (falls in Week 1 of 2025)', () => {
      // 2024-12-31 is a Tuesday, falls in the first ISO week of 2025.
      const date = new Date('2024-12-31T12:00:00Z');
      expect(getISOWeekId(date)).toBe('2025-W01');
    });

    test('should handle year boundary: Start of year 2023 (falls in Week 52 of 2022)', () => {
      // 2023-01-01 is a Sunday, which belongs to the last ISO week of 2022.
      const date = new Date('2023-01-01T12:00:00Z');
      expect(getISOWeekId(date)).toBe('2022-W52');
    });
  });

  describe('daysSinceLastUpdate', () => {
    test('should return 0 when lastUpdateDate equals currentDate', () => {
      const date = new Date('2025-10-01T12:00:00Z');
      expect(getDaysDifference(date, date)).toBe(0);
    });

    test('should return 3 if lastUpdateDate is 3 days in the future', () => {
      const currentDate = new Date('2025-10-01T12:00:00Z');
      const lastUpdateDate = new Date('2025-10-04T12:00:00Z');
      // differenceInDays(lastUpdateDate, currentDate) -> 3
      expect(getDaysDifference(lastUpdateDate, currentDate)).toBe(3);
    });

    test('should return 0 if lastUpdateDate is 3 days in the past (i.e., the update already occurred)', () => {
      const currentDate = new Date('2025-10-04T12:00:00Z');
      const lastUpdateDate = new Date('2025-10-01T12:00:00Z');
      // differenceInDays(lastUpdateDate, currentDate) -> -3
      // Math.max(0, -3) -> 0
      expect(getDaysDifference(lastUpdateDate, currentDate)).toBe(0);
    });

    test('should return 0 regardless of time if lastUpdateDate is in the past', () => {
      const currentDate = new Date('2025-10-02T01:00:00Z');
      const lastUpdateDate = new Date('2025-10-01T23:00:00Z');
      // differenceInDays ignores time, so lastUpdateDate (Oct 1) is before currentDate (Oct 2), resulting in -1
      expect(getDaysDifference(lastUpdateDate, currentDate)).toBe(0);
    });
  });

  describe('getCurrentWeekStart', () => {
    // All expected outputs for startOfWeek are at 00:00:00, so we use T00:00:00Z
    const expectedMonday = new Date('2025-09-29T00:00:00Z');

    test('should return the Monday of the week for a mid-week date (Wednesday)', () => {
      const wednesday = new Date('2025-10-01T12:00:00Z');
      expect(getCurrentWeekStart(wednesday)).toEqual(expectedMonday);
    });

    test('should return the date itself if the input is a Monday', () => {
      const monday = new Date('2025-09-29T12:00:00Z');
      // The time will be reset to midnight (T00:00:00Z)
      expect(getCurrentWeekStart(monday)).toEqual(expectedMonday);
    });

    test('should snap back to Monday for a Sunday', () => {
      const sunday = new Date('2025-10-05T12:00:00Z');
      expect(getCurrentWeekStart(sunday)).toEqual(expectedMonday);
    });

    test('should handle year boundary correctly (Monday, Jan 1st)', () => {
      // 2024-01-01 is a Monday
      const date = new Date('2024-01-01T12:00:00Z');
      const expected = new Date('2024-01-01T00:00:00Z');
      expect(getCurrentWeekStart(date)).toEqual(expected);
    });
  });
});
