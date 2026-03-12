import { useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import {
  contributionDataAtom,
  targetUserIdAtom,
} from '~/client/services/use-contributions';
import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution-graph';

import styles from './ContributionGraph.module.scss';

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

const getColorLevel = (count: number) => {
  if (count === 0) return 'level-0';
  if (count < 6) return 'level-1';
  if (count < 13) return 'level-2';
  if (count < 19) return 'level-3';
  return 'level-4';
};

const getPaddedContributions = (
  apiData: IContributionDay[],
): IContributionDay[] => {
  const padded: IContributionDay[] = [];
  const dataMap = new Map(apiData.map((d) => [d.date, d.count]));

  const end = new Date();
  const daysUntilSaturday = 6 - end.getDay();
  end.setDate(end.getDate() + daysUntilSaturday);

  const start = new Date(end);
  start.setDate(end.getDate() - 363);

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    padded.push({
      date: dateStr,
      count: dataMap.get(dateStr) || 0,
    });
    current.setDate(current.getDate() + 1);
  }

  return padded;
};

const getMonthLabels = (contributions: IContributionDay[]) => {
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

export const ContributionGraph = ({ userId }: { userId: string }) => {
  const [, setTargetUserId] = useAtom(targetUserIdAtom);

  const rawContributions = useAtomValue(contributionDataAtom);
  const contributions = getPaddedContributions(rawContributions);

  const monthLabels = getMonthLabels(contributions);

  let totalContributions = 0;
  for (const cont of contributions) {
    totalContributions += cont.count;
  }

  useEffect(() => {
    setTargetUserId(userId);
  }, [userId, setTargetUserId]);

  return (
    <div className={styles['contribution-box']}>
      {/* Shift months right to account for the width of the day labels */}
      <div className={styles['month-labels']} style={{ marginLeft: '32px' }}>
        {monthLabels.map((label, i) => (
          <span
            key={`${label.month}-${i}`}
            style={{ gridColumnStart: label.index + 1 }}
          >
            {label.month}
          </span>
        ))}
      </div>

      <div className={styles['graph-and-days']}>
        <div className={styles['day-labels']}>
          <span>Sun</span>
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
        </div>

        <div className={styles['graph-grid']}>
          {contributions.map((day) => {
            const levelClass = getColorLevel(day.count);
            return (
              <div
                key={day.date}
                className={`${styles['graph-square']} ${styles[levelClass]}`}
                data-tooltip={`${day.count} contributions on ${day.date}`}
              />
            );
          })}
        </div>
      </div>

      <div className={styles['info-bar']}>
        <div className={styles['total-contributions']}>
          {totalContributions} contributions in the past year
        </div>

        <div className={styles['color-guide']}>
          <span>Less</span>
          <div className={`${styles['graph-square']} ${styles['level-0']}`} />
          <div className={`${styles['graph-square']} ${styles['level-1']}`} />
          <div className={`${styles['graph-square']} ${styles['level-2']}`} />
          <div className={`${styles['graph-square']} ${styles['level-3']}`} />
          <div className={`${styles['graph-square']} ${styles['level-4']}`} />
          <span>More</span>
        </div>
      </div>
    </div>
  );
};
