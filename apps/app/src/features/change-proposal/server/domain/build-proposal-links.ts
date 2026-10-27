import type { BasedOnRelation, ProposalLinkView } from '../../interfaces';

export type LinkedProposalFacts = {
  readonly proposalId: string;
  readonly relation: BasedOnRelation;
  readonly operationKeys: readonly string[];
  readonly isVisibleToViewer: boolean;
};

export const buildProposalLinks = (
  _returnedOperationKeys: readonly string[],
  _linked: readonly LinkedProposalFacts[],
): ReadonlyMap<string, readonly ProposalLinkView[]> => {
  throw new Error('Not implemented');
};
