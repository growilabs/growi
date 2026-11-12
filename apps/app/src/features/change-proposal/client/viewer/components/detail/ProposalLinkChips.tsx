import type { JSX } from 'react';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

import {
  buildProposalHref,
  formatProposalShortId,
  PROPOSAL_LINK_LABEL_KEYS,
  type ProposalLinkKind,
} from '../../../shared';

export type ProposalLinkChip = {
  readonly proposalId: string;
  readonly kind: ProposalLinkKind;
};

type ProposalLinkChipsProps = { readonly links: readonly ProposalLinkChip[] };

export const ProposalLinkChips = ({
  links,
}: ProposalLinkChipsProps): JSX.Element | null => {
  const { t } = useTranslation();
  if (links.length === 0) {
    return null;
  }

  return (
    <span className="d-inline-flex flex-wrap gap-2 small">
      {links.map(({ proposalId, kind }) => (
        <span key={`${kind}:${proposalId}`}>
          {t(PROPOSAL_LINK_LABEL_KEYS[kind])}{' '}
          <Link href={buildProposalHref(proposalId)}>
            {formatProposalShortId(proposalId)}
          </Link>
        </span>
      ))}
    </span>
  );
};
