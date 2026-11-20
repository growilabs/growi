import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import UserDate from '~/components/User/UserDate';

import type { ChangeProposalView } from '../../../../interfaces';
import {
  buildProposalHref,
  formatProposalShortId,
  PROPOSAL_STATUS_LABEL_KEYS,
} from '../../../shared';
import { ENTRY_LABEL_KEYS } from '../../domain';
import { RequesterActionSlot } from '../RequesterActionSlot';
import { StatusBadge } from '../StatusBadge';
import { SymbolIcon } from '../SymbolIcon';
import { ENTRY_ICONS, PROPOSAL_STATUS_APPEARANCE } from '../status-appearance';
import { PerPageNotificationsLabel } from './PerPageNotificationsLabel';
import { ProposalLinkChips } from './ProposalLinkChips';
import { ProposalProgressLabel } from './ProposalProgressLabel';

import styles from './ProposalSummaryHeader.module.scss';

type ProposalSummaryHeaderProps = {
  readonly proposal: ChangeProposalView;
};

const Fact = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element => (
  <div className="col">
    <dt className="mb-1 small fw-semibold text-body-secondary">{label}</dt>
    <dd className="mb-0 text-break">{children}</dd>
  </div>
);

export const ProposalSummaryHeader = ({
  proposal,
}: ProposalSummaryHeaderProps): JSX.Element => {
  const { t } = useTranslation();
  const {
    requester,
    entry,
    modelLabel,
    createdAt,
    lastAppliedAt,
    status,
    revertOf,
    basedOn,
  } = proposal;

  return (
    <div className={styles.summary}>
      <div className={styles.status}>
        <StatusBadge
          size="md"
          appearance={PROPOSAL_STATUS_APPEARANCE[status]}
          label={t(PROPOSAL_STATUS_LABEL_KEYS[status])}
        />
        <ProposalProgressLabel view={proposal} />
        <PerPageNotificationsLabel view={proposal} />
      </div>
      <dl className="row row-cols-auto gx-4 gy-3 mb-0">
        <Fact label={t('change_proposal_viewer.detail.requested_by')}>
          <span className={styles.name}>{requester.name}</span>{' '}
          <span className={styles.username}>{`@${requester.username}`}</span>
        </Fact>
        <Fact label={t('change_proposal_viewer.detail.entry')}>
          <span className="d-inline-flex align-items-center gap-1 px-2 small bg-body-secondary rounded-1">
            <SymbolIcon name={ENTRY_ICONS[entry]} className="fs-6" />
            {t(ENTRY_LABEL_KEYS[entry])}
          </span>
        </Fact>
        {modelLabel != null && (
          <Fact label={t('change_proposal_viewer.detail.model')}>
            <span className={styles.model}>{modelLabel}</span>
          </Fact>
        )}
        <Fact label={t('change_proposal_viewer.detail.created_at')}>
          <UserDate dateTime={createdAt} />
        </Fact>
        {lastAppliedAt != null && (
          <Fact label={t('change_proposal_viewer.detail.last_applied_at')}>
            <UserDate dateTime={lastAppliedAt} />
          </Fact>
        )}
        {revertOf != null && (
          <Fact label={t('change_proposal_viewer.detail.reverts')}>
            <Link
              href={buildProposalHref(revertOf)}
              className="text-decoration-underline"
            >
              {formatProposalShortId(revertOf)}
            </Link>
          </Fact>
        )}
      </dl>
      {basedOn != null && (
        <div className={styles.links}>
          <ProposalLinkChips
            links={[{ proposalId: basedOn.proposalId, kind: 'based-on' }]}
          />
        </div>
      )}
      <RequesterActionSlot proposal={proposal} />
    </div>
  );
};
