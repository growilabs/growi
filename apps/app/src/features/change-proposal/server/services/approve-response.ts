import type {
  ApplyResult,
  ApproveResponse,
  OperationRecord,
} from '../../interfaces';

type ResultItem = Extract<ApplyResult, { type: 'done' }>['results'][number];

// markApproved counts proposals, not operations, so only the token tells which
// operations this request wrote (see design.md, 書き込んだ操作の判定).
export const keysApprovedBy = (
  operations: readonly OperationRecord[],
  decisionToken: string,
): readonly string[] =>
  operations
    .filter((op) => op.decisionToken === decisionToken)
    .map((op) => op.key);

const toResultItem = (op: OperationRecord): ResultItem => ({
  key: op.key,
  status: op.status,
  ...(op.reason == null ? {} : { reason: op.reason }),
});

/**
 * Answers for the reported keys only, in operation order: an apply also runs
 * what others approved, hidden operations included. A key this run handled
 * gets its apply result; any other gets its state as read after the apply.
 * `applied` is null when nothing was approved, so nothing was applied.
 */
export const buildApproveResponse = (
  operations: readonly OperationRecord[],
  reportedKeys: ReadonlySet<string>,
  applied: ApplyResult | null,
): ApproveResponse => {
  const reported = operations.filter((op) => reportedKeys.has(op.key));
  if (applied?.type === 'in-progress') {
    return { type: 'in-progress', results: reported.map(toResultItem) };
  }
  const fromApply = new Map(
    (applied?.results ?? []).map((item) => [item.key, item]),
  );
  return {
    type: 'done',
    results: reported.map((op) => fromApply.get(op.key) ?? toResultItem(op)),
  };
};
