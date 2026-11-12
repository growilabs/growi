import type { JSX } from 'react';

import type { RevisionMarkView } from '../../../interfaces';

type ProposalMarkBadgeProps = {
  readonly mark: RevisionMarkView;
  readonly size?: 'sm' | 'md';
};

export const ProposalMarkBadge = (
  _props: ProposalMarkBadgeProps,
): JSX.Element => {
  throw new Error('Not implemented');
};
