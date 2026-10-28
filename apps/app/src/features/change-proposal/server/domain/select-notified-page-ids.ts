import type { ChangeProposalDocument, OperationType } from '../../interfaces';

// A human page creation sends no in-app notification, so created pages are not
// notified either; delete-completely exists only in revert proposals.
const NOTIFIED_TYPES: {
  readonly [K in 'normal' | 'revert']: readonly OperationType[];
} = {
  normal: ['edit', 'move'],
  revert: ['edit', 'move', 'delete-completely'],
};

export const selectNotifiedPageIds = (
  proposal: Pick<ChangeProposalDocument, 'entry' | 'operations'>,
): string[] => {
  const types =
    NOTIFIED_TYPES[proposal.entry === 'revert' ? 'revert' : 'normal'];
  const pageIds = proposal.operations.flatMap((op) =>
    op.status === 'applied' && 'pageId' in op && types.includes(op.type)
      ? [op.pageId]
      : [],
  );
  return [...new Set(pageIds)];
};
