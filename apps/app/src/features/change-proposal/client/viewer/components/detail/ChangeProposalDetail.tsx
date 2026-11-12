import type { JSX } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';
import { useSWRxChangeProposal } from '../../stores/use-swrx-change-proposal';
import { OperationItem } from '../OperationItem';
import { ProposalSummaryHeader } from './ProposalSummaryHeader';

type ChangeProposalDetailProps = { readonly proposalId: string };

export const ChangeProposalDetail = ({
  proposalId,
}: ChangeProposalDetailProps): JSX.Element | null => {
  const { t } = useTranslation();
  const { data, error } = useSWRxChangeProposal(proposalId);

  if (error != null) {
    return (
      <div className="alert alert-danger">
        {t('change_proposal_viewer.detail.error')}
      </div>
    );
  }
  if (data == null) {
    return null;
  }
  if (data.type === 'not-found') {
    return (
      <div className="alert alert-secondary">
        {t('change_proposal_viewer.detail.not_found')}
      </div>
    );
  }

  const proposal: ChangeProposalView = data.proposal;

  return (
    <div>
      <ProposalSummaryHeader proposal={proposal} />
      <section>
        <h2 className="h5">{t('change_proposal_viewer.detail.operations')}</h2>
        {proposal.operations.map((operation) => (
          <OperationItem
            key={operation.key}
            proposal={proposal}
            operation={operation}
          />
        ))}
      </section>
    </div>
  );
};
