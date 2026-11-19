import type { BasedOnRelation, ProposalLinkView } from '../../interfaces';

export type LinkedProposalFacts = {
  readonly proposalId: string;
  readonly relation: BasedOnRelation;
  readonly operationKeys: readonly string[];
  readonly isVisibleToViewer: boolean;
};

export const buildProposalLinks = (
  returnedOperationKeys: readonly string[],
  linked: readonly LinkedProposalFacts[],
): ReadonlyMap<string, readonly ProposalLinkView[]> => {
  const returned = new Set(returnedOperationKeys);
  const links = new Map<string, ProposalLinkView[]>();

  for (const fact of linked) {
    if (!fact.isVisibleToViewer) {
      continue;
    }
    const view: ProposalLinkView = {
      proposalId: fact.proposalId,
      relation: fact.relation,
    };
    for (const key of fact.operationKeys) {
      if (!returned.has(key)) {
        continue;
      }
      links.set(key, [...(links.get(key) ?? []), view]);
    }
  }

  return links;
};
