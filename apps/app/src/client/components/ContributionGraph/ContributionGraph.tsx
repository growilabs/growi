import { useMemo } from 'react';

import { useSWRxContributions } from '~/stores/use-contributions';

import {
  getColorLevel,
  getMonthLabels,
  getPaddedContributions,
} from './utils/contribution-graph-utils';

import styles from './ContributionGraph.module.scss';

export const ContributionGraph = ({ userId }: { userId: string }) => {
  const { data } = useSWRxContributions(userId);

  const contributions = useMemo(() => {
    return data != null ? getPaddedContributions(data) : [];
  }, [data]);

  const monthLabels = useMemo(() => {
    return getMonthLabels(contributions);
  }, [contributions]);

  const totalContributions = useMemo(() => {
    return contributions.reduce((sum, cont) => sum + cont.count, 0);
  }, [contributions]);

  return (
    <div className={styles['contribution-box']}>
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
