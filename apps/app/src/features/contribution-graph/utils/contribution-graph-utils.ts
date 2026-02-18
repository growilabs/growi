import {
  differenceInDays,
  format,
  getISOWeek,
  getISOWeekYear,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
  startOfWeek,
  subWeeks,
} from 'date-fns';

import type { IContributionDay } from '../interfaces/contribution-graph';

/**
 * Gets current week's ISO week ID, e.g 2025-W32
 */
export const getISOWeekId = (date: Date): string => {
  const week = getISOWeek(date);
  const year = getISOWeekYear(date);

  return `${year}-W${String(week).padStart(2, '0')}`;
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
  return format(date, 'yyyy-MM-dd');
};

export function getStartDateFromISOWeek(weekId: string): Date {
  const [year, week] = weekId.split('-W').map(Number);

  let date = new Date(year, 0, 4, 12, 0, 0);

  date = setISOWeekYear(date, year);
  date = setISOWeek(date, week);

  return startOfISOWeek(date);
}

export function getCutoffWeekId(weeksToKeep = 52): string {
  const cutoffDate = subWeeks(new Date(), weeksToKeep);
  return getISOWeekId(cutoffDate);
}

export function getExpiredWeekIds(
  existingPermanentWeeks: Map<string, IContributionDay[]>,
  cutoffWeekId: string,
): string[] {
  const weeksArray = [...existingPermanentWeeks.keys()];

  return weeksArray.filter((weekId) => weekId < cutoffWeekId);
}
