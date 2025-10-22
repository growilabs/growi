/**
 * Gets current week's ISO week ID, e.g 2025-W32
 */
export const getISOWeekId = (date: Date): string => {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const diffInMs = utcDate.getTime() - yearStart.getTime();
  const oneDayInMs = 86400000;
  const weekNumber = Math.ceil(((diffInMs / oneDayInMs) + 1) / 7);
  const weekString = String(weekNumber).padStart(2, '0');

  const year = utcDate.getUTCFullYear();
  const weekId = `${year}-W${weekString}`;

  return weekId;
};


export const daysSinceLastUpdate = (
    lastUpdateDate: Date,
    currentDate: Date = new Date(),
): number => {
  const oneDayInMs = 86400000;
  const diffInMs = currentDate.getTime() - lastUpdateDate.getTime();
  const diffDays = Math.floor(diffInMs / oneDayInMs);

  return Math.max(0, diffDays);
};

export const getCurrentWeekStart = (date: Date = new Date()): Date => {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay();
  const diff = (day === 0) ? 6 : day - 1;
  utcDate.setUTCDate(utcDate.getUTCDate() - diff);

  return utcDate;
};
