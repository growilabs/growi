import { type JSX, useEffect, useState } from 'react';
import { useTranslation } from 'next-i18next';

import type { ChangeProposalView } from '../../../../interfaces';
import { useSWRxChangeProposal } from '../../stores/use-swrx-change-proposal';
import { OperationItem } from '../OperationItem';
import { RequesterOnlySection } from '../RequesterOnlySection';
import { StatePanel } from '../StatePanel';
import { ChangeProposalNotFound } from './ChangeProposalNotFound';
import { ProposalSummaryHeader } from './ProposalSummaryHeader';
import { RemainingOperationsList } from './RemainingOperationsList';
import { RevertAllButton } from './RevertAllButton';
import { RevertRequestModal } from './RevertRequestModal';
import type { RevertRun } from './RevertResultList';
import { RevertResultList } from './RevertResultList';

import styles from './ChangeProposalDetail.module.scss';

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

const SKELETON_OPERATION_KEYS = ['a', 'b'] as const;

const DetailSkeleton = (): JSX.Element => {
  const { t } = useTranslation();
  return (
    <div aria-busy="true">
      <span className="visually-hidden">{t('Loading')}</span>
      <div aria-hidden="true" className="placeholder-glow">
        <div className={styles.skeleton}>
          <span className="placeholder col-2 rounded-pill" />
          <span className="placeholder col-7" />
          <span className="placeholder col-5" />
        </div>
        {SKELETON_OPERATION_KEYS.map((key) => (
          <div key={key} className={styles.skeleton}>
            <span className="placeholder col-3" />
            <span className="placeholder col-8" />
          </div>
        ))}
      </div>
    </div>
  );
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
      <StatePanel icon="error" variant="error">
        {t('change_proposal_viewer.detail.error')}
      </StatePanel>
    );
  }
  if (data == null) {
    return <DetailSkeleton />;
  }

  // See design.md (ChangeProposalDetail) for why a not-found refetch is
  // ignored while a revert result is shown.
  const proposal = found ?? (revertRun != null ? lastFound : null);
  if (proposal == null) {
    return <ChangeProposalNotFound />;
  }

  return (
    <div className={styles.detail}>
      <ProposalSummaryHeader proposal={proposal} />
      <div className={styles.actions}>
        <RevertAllButton
          proposal={proposal}
          onReverted={(run) => setRevertState({ proposalId, run })}
        />
        <RevertRequestModal proposal={proposal} />
      </div>
      {revertRun != null && (
        <RevertResultList
          proposalId={proposalId}
          run={revertRun}
          originalOperations={proposal.operations}
        />
      )}
      <RequesterOnlySection view={proposal} />
      <RemainingOperationsList view={proposal} />
      <section className={styles.operations}>
        <h2 className={styles['section-title']}>
          {t('change_proposal_viewer.detail.operations')}
        </h2>
        <ul className={styles['operation-list']}>
          {proposal.operations.map((operation) => (
            <li key={operation.key}>
              <OperationItem proposal={proposal} operation={operation} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
