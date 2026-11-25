import type {
  OperationRecord,
  ReviewerInput,
  ReviewRequestNotificationSnapshot,
  ReviewResultNotificationSnapshot,
} from '../../interfaces';

export type ReviewRequestPage =
  ReviewRequestNotificationSnapshot['pages'][number];
export type ReviewResultContent = Pick<
  ReviewResultNotificationSnapshot,
  'items' | 'wholeRejection'
>;
export type ReviewOutcome =
  ReviewResultNotificationSnapshot['items'][number]['result'];

// What one request decided: the operations it approved or recorded a decision
// on, or a rejection of the whole proposal.
export type ReviewDecisionNotice =
  | {
      readonly kind: 'operations';
      readonly result: ReviewOutcome;
      readonly operationKeys: readonly string[];
      readonly comment?: string;
    }
  | { readonly kind: 'whole-rejection'; readonly comment?: string };

export const selectReviewRequestRecipientIds = (
  candidates: readonly ReviewerInput[],
  requesterId: string,
  actorId: string,
): readonly string[] => [
  ...new Set(
    candidates
      .filter((c) => c.kind === 'user')
      .map((c) => c.id)
      .filter((id) => id !== requesterId && id !== actorId),
  ),
];

// `pagePaths` holds only pages the recipient may view, so an operation whose
// page is not in it is left out rather than named by a guessed path.
const toNotificationPage = (
  op: OperationRecord,
  pagePaths: ReadonlyMap<string, string>,
): ReviewRequestPage | null => {
  if (op.type === 'create') {
    return { path: op.path };
  }
  const path = pagePaths.get(op.pageId);
  return path == null ? null : { id: op.pageId, path };
};

const selectByKeys = (
  operations: readonly OperationRecord[],
  keys: ReadonlySet<string>,
  pagePaths: ReadonlyMap<string, string>,
): readonly ReviewRequestPage[] => {
  const byPage = new Map<string, ReviewRequestPage>();
  for (const op of operations) {
    const page = keys.has(op.key) ? toNotificationPage(op, pagePaths) : null;
    if (page != null && !byPage.has(page.id ?? page.path)) {
      byPage.set(page.id ?? page.path, page);
    }
  }
  return [...byPage.values()];
};

export const buildReviewRequestPages = (
  operations: readonly OperationRecord[],
  targetKeys: ReadonlySet<string>,
  pagePaths: ReadonlyMap<string, string>,
): readonly ReviewRequestPage[] =>
  selectByKeys(operations, targetKeys, pagePaths);

/**
 * null when there is nothing to tell the requester: no decided operation is
 * one the requester sees, and the request rejected no whole proposal.
 */
export const buildReviewResultContent = (
  operations: readonly OperationRecord[],
  decision: ReviewDecisionNotice,
  requesterVisibleKeys: ReadonlySet<string>,
  pagePaths: ReadonlyMap<string, string>,
): ReviewResultContent | null => {
  const comment = decision.comment == null ? {} : { comment: decision.comment };
  if (decision.kind === 'whole-rejection') {
    return { items: [], wholeRejection: comment };
  }
  const decided = new Set(
    decision.operationKeys.filter((key) => requesterVisibleKeys.has(key)),
  );
  const items = selectByKeys(operations, decided, pagePaths).map(
    ({ path }) => ({ path, result: decision.result, ...comment }),
  );
  return items.length === 0 ? null : { items };
};
