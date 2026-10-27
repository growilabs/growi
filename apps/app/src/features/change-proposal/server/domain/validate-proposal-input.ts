import type {
  CreatableOperationInput,
  CreatableOperationType,
} from '../../interfaces';

export type ProposalInputLimits = {
  readonly maxOperations: number | null;
  readonly maxTotalBodyBytes: number;
  readonly enabledOperationTypes: ReadonlySet<CreatableOperationType>;
};

export type InputRejection =
  | { readonly code: 'unsupported-operation-type'; readonly index: number }
  | { readonly code: 'multiple-move-operations' }
  | { readonly code: 'too-many-operations'; readonly max: number }
  | { readonly code: 'body-too-large' }
  | { readonly code: 'operation-type-disabled'; readonly index: number }
  | { readonly code: 'invalid-path'; readonly index: number }
  | { readonly code: 'empty-operations' };

export const validateProposalInput = (
  _operations: readonly CreatableOperationInput[],
  _limits: ProposalInputLimits,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly rejection: InputRejection } => {
  throw new Error('Not implemented');
};
