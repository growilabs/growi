import type { OperationRecord, OperationStatus } from '../../interfaces';

export type VisibilityContext = {
  readonly isRequester: boolean;
  readonly viewablePageIds: ReadonlySet<string>;
  readonly anyoneWithLinkPageIds: ReadonlySet<string>;
};

// Statuses that say nothing about work in flight or never done, safe for non-requesters.
const STATUSES_VISIBLE_TO_OTHERS: ReadonlySet<OperationStatus> = new Set([
  'applied',
  'reverted',
  'revert-refused',
]);

// A create has no page until it is applied, so its target is the result page.
export const targetPageIdOf = (op: OperationRecord): string | undefined =>
  op.type === 'create' ? op.resultPageId : op.pageId;

const isVisible = (op: OperationRecord, ctx: VisibilityContext): boolean => {
  const pageId = targetPageIdOf(op);

  if (pageId == null) {
    return ctx.isRequester;
  }
  if (!ctx.viewablePageIds.has(pageId)) {
    return false;
  }
  if (ctx.isRequester) {
    return true;
  }
  return (
    STATUSES_VISIBLE_TO_OTHERS.has(op.status) &&
    !ctx.anyoneWithLinkPageIds.has(pageId)
  );
};

export const selectVisibleOperations = (
  operations: readonly OperationRecord[],
  ctx: VisibilityContext,
): readonly OperationRecord[] => operations.filter((op) => isVisible(op, ctx));
