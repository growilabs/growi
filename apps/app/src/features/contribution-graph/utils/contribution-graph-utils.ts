import { differenceInDays, format, startOfWeek } from 'date-fns';

/**
 * Gets current week's ISO week ID, e.g 2025-W32
 */
export const getISOWeekId = (date: Date): string => {
  return format(date, "RRRR-'W'II");
};

export const getDaysDifference = (dateFrom: Date, dateTo: Date = new Date()): number => {
  const diffDays = differenceInDays(dateFrom, dateTo);
  return Math.max(0, diffDays);
};

export const getCurrentWeekStart = (date: Date = new Date()): Date => {
  return startOfWeek(date, { weekStartsOn: 1 });
};
