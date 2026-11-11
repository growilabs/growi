import type {
  OperationRecord,
  ProposalEntry,
  Revertability,
  RevertRefusalReason,
} from '../../interfaces';

export type CurrentPageFacts = {
  readonly exists: boolean;
  readonly path: string | null;
  readonly latestRevisionId: string | null;
  readonly hasChildren: boolean;
  // Whether the viewer may delete the page completely under the admin's deletion
  // authorities (see canDeletePageCompletely).
  readonly canDelete: boolean;
  // True only when a non-empty page sits at the path; an empty placeholder page
  // does not block revertDeletedPage, so it must not count as occupied.
  readonly isPathOccupied: (path: string) => boolean;
};

const REVERTIBLE: Revertability = { revertible: true };

const refuse = (reason: RevertRefusalReason): Revertability => ({
  revertible: false,
  reason,
});

const judgeRemovableNewPage = (
  expectedRevisionId: string | undefined,
  facts: CurrentPageFacts,
): Revertability => {
  if (facts.hasChildren) return refuse('has-children');
  if (facts.latestRevisionId !== expectedRevisionId) {
    return refuse('edited-after-apply');
  }
  if (!facts.canDelete) return refuse('not-deletable');
  return REVERTIBLE;
};

export const judgeRevertability = (
  op: OperationRecord,
  _proposalEntry: ProposalEntry,
  facts: CurrentPageFacts,
): Revertability => {
  if (op.status !== 'applied' && op.status !== 'revert-refused') {
    return refuse('not-revertible-state');
  }
  if (!facts.exists) return refuse('target-unavailable');

  switch (op.type) {
    case 'edit':
      return facts.latestRevisionId === op.resultRevisionId
        ? REVERTIBLE
        : refuse('edited-after-apply');
    case 'create':
      return judgeRemovableNewPage(op.resultRevisionId, facts);
    case 'move':
      if (facts.path !== op.toPath) return refuse('moved-after-apply');
      if (facts.isPathOccupied(op.fromPath)) {
        return refuse('original-path-occupied');
      }
      return REVERTIBLE;
    // The deleted page is gone for good, so nothing can bring it back.
    case 'delete-completely':
      return refuse('target-unavailable');
    default: {
      const unreachable: never = op;
      throw new Error(`Unknown operation: ${JSON.stringify(unreachable)}`);
    }
  }
};
