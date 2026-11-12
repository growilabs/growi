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

export const deriveRevertProgress = (_args: {
  readonly originalProposalId: string;
  readonly sentKeys: readonly string[];
  readonly result: RevertResult;
  readonly revertProposal: ChangeProposalView | null;
  readonly originalOperations: readonly OperationView[];
}): {
  readonly entries: readonly RevertProgressEntry[];
  readonly isSettled: boolean;
} => {
  throw new Error('Not implemented');
};
