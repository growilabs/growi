import { type JSX, useRef } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { UncontrolledTooltip } from 'reactstrap';

import type { RevisionMarkView } from '../../../interfaces';
import { buildProposalHref } from '../../shared';

type ProposalMarkBadgeProps = {
  readonly mark: RevisionMarkView;
  readonly size?: 'sm' | 'md';
};

export const ProposalMarkBadge = ({
  mark,
  size = 'md',
}: ProposalMarkBadgeProps): JSX.Element => {
  const { t } = useTranslation();
  const targetRef = useRef<HTMLAnchorElement>(null);

  const kind = mark.isRevert ? 'revert' : 'change_proposal';

  return (
    <>
      <Link
        ref={targetRef}
        href={buildProposalHref(mark.proposalId)}
        className={`badge rounded-pill text-bg-secondary text-decoration-none ${
          size === 'sm' ? 'fs-xs' : ''
        }`}
      >
        {t(`change_proposal_viewer.mark.${kind}`)}
      </Link>
      <UncontrolledTooltip target={targetRef} placement="top">
        {t(`change_proposal_viewer.mark.tooltip.${kind}`)}
      </UncontrolledTooltip>
    </>
  );
};
