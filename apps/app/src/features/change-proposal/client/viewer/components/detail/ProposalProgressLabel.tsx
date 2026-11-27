import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';
import {
  ACHIEVEMENT_LABEL_KEY,
  PROPOSAL_LIFECYCLE_LABEL_KEYS,
  toAchievementPercent,
} from '../../../shared';

type ProposalProgressLabelProps = {
  readonly view: Pick<ChangeProposalView, 'requesterState'>;
};

export const ProposalProgressLabel = ({
  view,
}: ProposalProgressLabelProps): JSX.Element | null => {
  const { t } = useTranslation();
  const { requesterState } = view;
  if (requesterState == null || requesterState.lifecycle === 'open') {
    return null;
  }

  const { lifecycle, achievement } = requesterState;
  const percent =
    lifecycle === 'settled' && achievement != null
      ? toAchievementPercent(achievement)
      : null;

  return (
    <span className="small text-muted">
      {percent != null
        ? t(ACHIEVEMENT_LABEL_KEY, { percent })
        : t(PROPOSAL_LIFECYCLE_LABEL_KEYS[lifecycle])}
    </span>
  );
};
