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

export const isOwnPageForAutoApply = (
  _page: AutoApplyPageFacts,
  _requesterId: string,
): boolean => {
  throw new Error('Not implemented');
};

export const selectAutoApplyTargets = (
  _policy: AutoApplyPolicy,
  _operations: readonly OperationRecord[],
  _pageFacts: ReadonlyMap<string, AutoApplyPageFacts>,
  _requesterId: string,
  _relation: BasedOnRelation | null,
): readonly number[] => {
  throw new Error('Not implemented');
};
