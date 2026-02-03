import { differenceInDays, format, startOfWeek } from 'date-fns';

/**
 * Gets current week's ISO week ID, e.g 2025-W32
 */
export const getISOWeekId = (date: Date): string => {
  return format(date, "RRRR-'W'II");
};

export const getDaysDifference = (
  dateFrom: Date,
  dateTo: Date = new Date(),
): number => {
  const diffDays = differenceInDays(dateFrom, dateTo);
  return Math.max(0, diffDays);
};

export const getCurrentWeekStart = (date: Date = new Date()): Date => {
  return startOfWeek(date, { weekStartsOn: 1 });
};

export const getUTCMidnightToday = () => {
  const currentTime = new Date();

  return new Date(
    Date.UTC(
      currentTime.getUTCFullYear(),
      currentTime.getUTCMonth(),
      currentTime.getUTCDate(),
    ),
  );
};

export const formatDateKey = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function getStartDateFromISOWeek(weekId: string): Date {
  const [yearStr, weekStr] = weekId.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);

  // Week 1 is the week with the first Thursday of the year.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayOfFirstWeek = new Date(jan4);
  mondayOfFirstWeek.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));

  const targetMonday = new Date(mondayOfFirstWeek);
  targetMonday.setUTCDate(mondayOfFirstWeek.getUTCDate() + (week - 1) * 7);

  return targetMonday;
}

export function getCutoffWeekId(weeksToKeep = 52): string {
  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - weeksToKeep * 7);

  return getISOWeekId(cutoffDate);
}

export function getExpiredWeekIds(
  existingPermanentWeeks: Record<string, any>,
  cutoffWeekId: string,
): string[] {
  return Object.keys(existingPermanentWeeks).filter(
    (weekId) => weekId < cutoffWeekId,
  );
}
