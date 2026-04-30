import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution-graph';

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const getMonthLabels = (contributions: IContributionDay[]) => {
  const labels: { month: string; index: number }[] = [];

  contributions.forEach((day, i) => {
    if (i % 7 === 0) {
      const date = new Date(day.date);
      const monthName = months[date.getMonth()];
      const dayOfMonth = date.getDate();
      const columnIndex = Math.floor(i / 7);

      if (i === 0) {
        labels.push({ month: monthName, index: 0 });
        return;
      }

      if (dayOfMonth <= 7) {
        const lastLabel = labels[labels.length - 1];

        if (
          lastLabel.month !== monthName &&
          columnIndex - lastLabel.index > 2
        ) {
          labels.push({ month: monthName, index: columnIndex });
        }
      }
    }
  });

  return labels;
};

export const getColorLevel = (count: number) => {
  if (count === 0) return 'level-0';
  if (count < 6) return 'level-1';
  if (count < 13) return 'level-2';
  if (count < 19) return 'level-3';
  return 'level-4';
};

export const getPaddedContributions = (
  apiData: IContributionDay[],
  now: Date = new Date(),
): IContributionDay[] => {
  const padded: IContributionDay[] = [];
  const dataMap = new Map(apiData.map((d) => [d.date, d.count]));

  const end = new Date(now);
  const daysUntilSaturday = 6 - end.getUTCDay();
  end.setUTCDate(end.getUTCDate() + daysUntilSaturday);

  const current = new Date(end);
  current.setUTCDate(end.getUTCDate() - 370);

  while (current <= end) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    padded.push({
      date: dateStr,
      count: dataMap.get(dateStr) || 0,
    });

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return padded;
};
