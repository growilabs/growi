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
import { PerPageNotificationsLabel } from './PerPageNotificationsLabel';
import { ProposalLinkChips } from './ProposalLinkChips';
import { ProposalProgressLabel } from './ProposalProgressLabel';

type ProposalSummaryHeaderProps = {
  readonly proposal: ChangeProposalView;
};

const HeaderRow = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element => (
  <div className="d-flex gap-2">
    <dt className="fw-normal text-muted">{label}</dt>
    <dd className="mb-0">{children}</dd>
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
    <div className="mb-3">
      <dl className="mb-0">
        <HeaderRow label={t('change_proposal_viewer.detail.requested_by')}>
          <span>{`${requester.name} (@${requester.username})`}</span>
        </HeaderRow>
        <HeaderRow label={t('change_proposal_viewer.detail.entry')}>
          {t(ENTRY_LABEL_KEYS[entry])}
        </HeaderRow>
        {modelLabel != null && (
          <HeaderRow label={t('change_proposal_viewer.detail.model')}>
            {modelLabel}
          </HeaderRow>
        )}
        <HeaderRow label={t('change_proposal_viewer.detail.created_at')}>
          <UserDate dateTime={createdAt} />
        </HeaderRow>
        {lastAppliedAt != null && (
          <HeaderRow label={t('change_proposal_viewer.detail.last_applied_at')}>
            <UserDate dateTime={lastAppliedAt} />
          </HeaderRow>
        )}
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="badge text-bg-secondary">
            {t(PROPOSAL_STATUS_LABEL_KEYS[status])}
          </span>
          <ProposalProgressLabel view={proposal} />
          <PerPageNotificationsLabel view={proposal} />
        </div>
        {revertOf != null && (
          <HeaderRow label={t('change_proposal_viewer.detail.reverts')}>
            <Link href={buildProposalHref(revertOf)}>
              {formatProposalShortId(revertOf)}
            </Link>
          </HeaderRow>
        )}
      </dl>
      {basedOn != null && (
        <ProposalLinkChips
          links={[{ proposalId: basedOn.proposalId, kind: 'based-on' }]}
        />
      )}
      <RequesterActionSlot proposal={proposal} />
    </div>
  );
};
