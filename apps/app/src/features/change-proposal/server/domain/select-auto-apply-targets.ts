import type {
  AutoApplyPolicy,
  BasedOnRelation,
  OperationRecord,
} from '../../interfaces';

export type AutoApplyPageFacts = {
  readonly pageId: string;
  readonly creatorId: string | null;
  readonly lastUpdateUserId: string | null;
};

// Provisional (design OQ-3): "own page" is decided by the creator until the
// definition (creator vs last updater) is settled. Keep this the only place.
export const isOwnPageForAutoApply = (
  page: AutoApplyPageFacts,
  requesterId: string,
): boolean => page.creatorId != null && page.creatorId === requesterId;

export const selectAutoApplyTargets = (
  policy: AutoApplyPolicy,
  operations: readonly OperationRecord[],
  pageFacts: ReadonlyMap<string, AutoApplyPageFacts>,
  requesterId: string,
  relation: BasedOnRelation | null,
): readonly number[] => {
  if (relation === 'rework' || policy === 'none') {
    return [];
  }
  if (policy === 'all') {
    return operations.map((op) => op.index);
  }
  return operations
    .filter((op) => {
      if (op.type === 'create') {
        return true;
      }
      // A move is judged by its source page, which is the one it carries.
      const page = pageFacts.get(op.pageId);
      return page != null && isOwnPageForAutoApply(page, requesterId);
    })
    .map((op) => op.index);
};
