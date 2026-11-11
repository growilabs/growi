import type { IRevisionProposalMark } from '@growi/core';

import type { ProposalMark } from '../../interfaces';

export const toRevisionProposalMark = (
  mark: ProposalMark,
): IRevisionProposalMark => {
  return {
    proposalId: mark.proposalId,
    proposalOperationKey: mark.operationKey,
  };
};
