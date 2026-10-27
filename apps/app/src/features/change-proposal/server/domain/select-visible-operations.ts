import type { OperationRecord } from '../../interfaces';

export type VisibilityContext = {
  readonly isRequester: boolean;
  readonly viewablePageIds: ReadonlySet<string>;
  readonly anyoneWithLinkPageIds: ReadonlySet<string>;
};

export const selectVisibleOperations = (
  _operations: readonly OperationRecord[],
  _ctx: VisibilityContext,
): readonly OperationRecord[] => {
  throw new Error('Not implemented');
};
