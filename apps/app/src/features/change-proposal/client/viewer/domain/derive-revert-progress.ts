import type {
  ChangeProposalView,
  OperationView,
  RevertRefusalReason,
  RevertResult,
} from '../../../interfaces';

export type RevertProgressEntry =
  | { readonly key: string; readonly state: 'in-progress' }
  | { readonly key: string; readonly state: 'reverted' }
  | {
      readonly key: string;
      readonly state: 'revert-refused';
      readonly reason?: RevertRefusalReason;
    }
  | {
      readonly key: string;
      readonly state: 'skipped';
      readonly reason: 'page-being-edited';
    }
  | { readonly key: string; readonly state: 'not-targeted' };

const REVERT_REFUSAL_REASONS: Readonly<Record<RevertRefusalReason, true>> = {
  'not-revertible-state': true,
  'target-unavailable': true,
  'edited-after-apply': true,
  'has-children': true,
  'moved-after-apply': true,
  'original-path-occupied': true,
  'page-operation-in-progress': true,
  'not-deletable': true,
  'apply-failed': true,
};

const isRevertRefusalReason = (
  reason: OperationView['reason'],
): reason is RevertRefusalReason =>
  reason != null && Object.hasOwn(REVERT_REFUSAL_REASONS, reason);

const deriveFromRevertOperation = (
  key: string,
  operation: OperationView,
  originalOperations: readonly OperationView[],
): RevertProgressEntry => {
  switch (operation.status) {
    case 'pending':
      return { key, state: 'in-progress' };
    case 'applied':
    case 'reverted':
    case 'revert-refused':
      return { key, state: 'reverted' };
    case 'skipped':
      return { key, state: 'skipped', reason: 'page-being-edited' };
    case 'failed':
    case 'stale': {
      const original = originalOperations.find((o) => o.key === key);
      return original?.status === 'revert-refused' &&
        isRevertRefusalReason(original.reason)
        ? { key, state: 'revert-refused', reason: original.reason }
        : { key, state: 'revert-refused' };
    }
  }
};

export const deriveRevertProgress = ({
  originalProposalId,
  sentKeys,
  result,
  revertProposal,
  originalOperations,
}: {
  readonly originalProposalId: string;
  readonly sentKeys: readonly string[];
  readonly result: RevertResult;
  readonly revertProposal: ChangeProposalView | null;
  readonly originalOperations: readonly OperationView[];
}): {
  readonly entries: readonly RevertProgressEntry[];
  readonly isSettled: boolean;
} => {
  const entries = sentKeys.map((key): RevertProgressEntry => {
    const settled = result.operations.find((o) => o.key === key);
    if (settled != null) {
      switch (settled.outcome) {
        case 'reverted':
          return { key, state: 'reverted' };
        case 'revert-refused':
          return { key, state: 'revert-refused', reason: settled.reason };
        case 'skipped':
          return { key, state: 'skipped', reason: settled.reason };
      }
    }
    if (result.revertProposalId == null) {
      return { key, state: 'not-targeted' };
    }
    if (revertProposal == null) {
      return { key, state: 'in-progress' };
    }
    const revertOperation = revertProposal.operations.find(
      (o) =>
        o.revertTarget?.proposalId === originalProposalId &&
        o.revertTarget.operationKey === key,
    );
    if (revertOperation == null) {
      return { key, state: 'not-targeted' };
    }
    return deriveFromRevertOperation(key, revertOperation, originalOperations);
  });

  return {
    entries,
    isSettled: entries.every((e) => e.state !== 'in-progress'),
  };
};
