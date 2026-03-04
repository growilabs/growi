import { useEffect } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import {
  contributionDataAtom,
  targetUserIdAtom,
} from '~/client/services/use-contributions';
import type { IContributionDay } from '~/features/contribution-graph/interfaces/contribution-graph';

export const ContributionGraph = ({ userId }: { userId: string }) => {
  const [, setTargetUserId] = useAtom(targetUserIdAtom);

  const contributions = useAtomValue(contributionDataAtom);
  const test: IContributionDay[] = [];

  for (const cont of contributions) {
    test.push(cont);
  }

  useEffect(() => {
    setTargetUserId(userId);
  }, [userId, setTargetUserId]);

  return (
    <ul>
      {test.map((day) => (
        <li key={day.date}>
          {day.count} contributions on {day.date}
        </li>
      ))}
    </ul>
  );
};
