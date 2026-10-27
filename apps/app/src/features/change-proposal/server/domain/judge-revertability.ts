import type {
  OperationRecord,
  ProposalEntry,
  Revertability,
} from '../../interfaces';

export type CurrentPageFacts = {
  readonly exists: boolean;
  readonly path: string | null;
  readonly latestRevisionId: string | null;
  readonly hasChildren: boolean;
  readonly isPathOccupied: (path: string) => boolean;
};

export const judgeRevertability = (
  _op: OperationRecord,
  _proposalEntry: ProposalEntry,
  _facts: CurrentPageFacts,
): Revertability => {
  throw new Error('Not implemented');
};
