// !!
// not sure where to put the utility functions
// so put them here temporarely


export const getISOWeekId = (date: Date) => {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const oneDayInMs = 86400000; // 1000 * 60 * 60 * 24
  const diffInMs = utcDate.getTime() - yearStart.getTime();
  const weekNumber = Math.ceil(((diffInMs / oneDayInMs) + 1) / 7);
  const weekId = `${utcDate.getFullYear}-W${weekNumber}`;

  return weekId;
};


export const daysSinceLastUpdate = (lastUpdateDate: Date, currentDate: Date = new Date()) => {


};
