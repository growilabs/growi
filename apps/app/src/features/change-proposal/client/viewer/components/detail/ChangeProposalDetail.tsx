import { type JSX, useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';
import { useSWRxChangeProposal } from '../../stores/use-swrx-change-proposal';
import { OperationItem } from '../OperationItem';
import { ProposalSummaryHeader } from './ProposalSummaryHeader';
import { RevertAllButton } from './RevertAllButton';
import { RevertRequestModal } from './RevertRequestModal';
import type { RevertRun } from './RevertResultList';
import { RevertResultList } from './RevertResultList';

type ChangeProposalDetailProps = { readonly proposalId: string };

const useLastFoundProposal = (
  proposalId: string,
  current: ChangeProposalView | null,
): ChangeProposalView | null => {
  const [lastFound, setLastFound] = useState<ChangeProposalView | null>(null);
  useEffect(() => {
    if (current != null) {
      setLastFound(current);
    }
  }, [current]);
  return lastFound?.id === proposalId ? lastFound : null;
};

export const ChangeProposalDetail = ({
  proposalId,
}: ChangeProposalDetailProps): JSX.Element | null => {
  const { t } = useTranslation();
  const { data, error } = useSWRxChangeProposal(proposalId);
  const [revertState, setRevertState] = useState<{
    readonly proposalId: string;
    readonly run: RevertRun;
  } | null>(null);
  const revertRun =
    revertState?.proposalId === proposalId ? revertState.run : null;

  const found = data?.type === 'found' ? data.proposal : null;
  const lastFound = useLastFoundProposal(proposalId, found);

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

  // See design.md (ChangeProposalDetail) for why a not-found refetch is
  // ignored while a revert result is shown.
  const proposal = found ?? (revertRun != null ? lastFound : null);
  if (proposal == null) {
    return (
      <div className="alert alert-secondary">
        {t('change_proposal_viewer.detail.not_found')}
      </div>
    );
  }

  return (
    <div>
      <ProposalSummaryHeader proposal={proposal} />
      <RevertAllButton
        proposal={proposal}
        onReverted={(run) => setRevertState({ proposalId, run })}
      />
      <RevertRequestModal proposal={proposal} />
      {revertRun != null && (
        <RevertResultList
          proposalId={proposalId}
          run={revertRun}
          originalOperations={proposal.operations}
        />
      )}
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
