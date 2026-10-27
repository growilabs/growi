import { isCreatablePage } from '@growi/core/dist/utils/page-path-utils';

import type {
  CreatableOperationInput,
  CreatableOperationType,
} from '../../interfaces';

const CREATABLE_TYPES: readonly string[] = ['edit', 'create', 'move'];

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

const rejectWith = (
  rejection: InputRejection,
): { readonly ok: false; readonly rejection: InputRejection } => ({
  ok: false,
  rejection,
});

const bodyBytesOf = (operation: CreatableOperationInput): number =>
  operation.type === 'move' ? 0 : Buffer.byteLength(operation.body, 'utf8');

const destinationPathOf = (
  operation: CreatableOperationInput,
): string | null => {
  if (operation.type === 'create') return operation.path;
  if (operation.type === 'move') return operation.toPath;
  return null;
};

const isUsablePagePath = (path: string): boolean =>
  path.startsWith('/') && isCreatablePage(path);

export const validateProposalInput = (
  operations: readonly CreatableOperationInput[],
  limits: ProposalInputLimits,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly rejection: InputRejection } => {
  if (operations.length === 0) {
    return rejectWith({ code: 'empty-operations' });
  }

  // Entries are untyped at runtime (e.g. an LLM tool call), so check the type value itself.
  const unsupportedIndex = operations.findIndex(
    (o) => !CREATABLE_TYPES.includes(o.type),
  );
  if (unsupportedIndex !== -1) {
    return rejectWith({
      code: 'unsupported-operation-type',
      index: unsupportedIndex,
    });
  }

  if (operations.filter((o) => o.type === 'move').length > 1) {
    return rejectWith({ code: 'multiple-move-operations' });
  }

  if (
    limits.maxOperations != null &&
    operations.length > limits.maxOperations
  ) {
    return rejectWith({
      code: 'too-many-operations',
      max: limits.maxOperations,
    });
  }

  const totalBytes = operations.reduce((sum, o) => sum + bodyBytesOf(o), 0);
  if (totalBytes > limits.maxTotalBodyBytes) {
    return rejectWith({ code: 'body-too-large' });
  }

  const disabledIndex = operations.findIndex(
    (o) => !limits.enabledOperationTypes.has(o.type),
  );
  if (disabledIndex !== -1) {
    return rejectWith({
      code: 'operation-type-disabled',
      index: disabledIndex,
    });
  }

  const invalidPathIndex = operations.findIndex((o) => {
    const path = destinationPathOf(o);
    return path != null && !isUsablePagePath(path);
  });
  if (invalidPathIndex !== -1) {
    return rejectWith({ code: 'invalid-path', index: invalidPathIndex });
  }

  return { ok: true };
};
