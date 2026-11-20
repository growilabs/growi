import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import { StatePanel } from '../StatePanel';

// The one not-found display: an invalid id, a missing proposal and a proposal
// the viewer cannot see must look the same.
export const ChangeProposalNotFound = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <StatePanel icon="search_off">
      {t('change_proposal_viewer.detail.not_found')}
    </StatePanel>
  );
};
