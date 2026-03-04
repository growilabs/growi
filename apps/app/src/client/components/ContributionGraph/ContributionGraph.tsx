import { useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import {
  contributionDataAtom,
  targetUserIdAtom,
} from '~/client/services/use-contributions';

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

export const ContributionGraph = ({ userId }: { userId: string }) => {
  const [, setTargetUserId] = useAtom(targetUserIdAtom);

  const contributions = useAtomValue(contributionDataAtom);

  let totalContributions = 0;
  for (const cont of contributions) {
    totalContributions += cont.count;
  }

  useEffect(() => {
    setTargetUserId(userId);
  }, [userId, setTargetUserId]);

  return (
    <div className={styles['contribution-box']}>
      <div className={styles['month-labels']}>
        {months.map((month) => (
          <span key={month}>{month}</span>
        ))}
      </div>

      <div className={styles['graph-grid']}>
        {contributions.map((day) => {
          const levelClass = getColorLevel(day.count);
          return (
            <div
              key={day.date}
              className={`${styles['graph-square']} ${styles[levelClass]}`}
              title={`${day.count} contributions on ${day.date}`}
            />
          );
        })}
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
