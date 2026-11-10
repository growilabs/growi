import type { CreatableEntry, CreatableOperationInput } from '../../interfaces';
import type { InputRejection } from '../domain';

export const MODEL_LABEL_MAX_CODE_POINTS = 100;

const CREATABLE_ENTRIES: readonly string[] = [
  'ai-chat',
  'vault',
  'mcp',
] satisfies readonly CreatableEntry[];

// Shape checks the domain validator relies on: it assumes string bodies and paths.
export type CreateInputRejection =
  | InputRejection
  | { readonly code: 'invalid-entry' }
  | { readonly code: 'model-label-too-long'; readonly max: number }
  | { readonly code: 'invalid-operation'; readonly index: number };

export type NormalizedCreateInput = {
  readonly entry: CreatableEntry;
  readonly modelLabel?: string;
  readonly operations: readonly CreatableOperationInput[];
};

const isString = (value: unknown): value is string => typeof value === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null;

// Copies only the declared fields so nothing else from the caller reaches the document.
// An unknown type passes through untouched for validateProposalInput to reject.
const normalizeOperation = (
  op: unknown,
): CreatableOperationInput | 'invalid' => {
  if (!isRecord(op)) {
    return 'invalid';
  }
  switch (op.type) {
    case 'edit':
      return isString(op.pageId) &&
        isString(op.baseRevisionId) &&
        isString(op.body)
        ? {
            type: 'edit',
            pageId: op.pageId,
            baseRevisionId: op.baseRevisionId,
            body: op.body,
          }
        : 'invalid';
    case 'create':
      return isString(op.path) && isString(op.body)
        ? { type: 'create', path: op.path, body: op.body }
        : 'invalid';
    case 'move':
      return isString(op.pageId) && isString(op.fromPath) && isString(op.toPath)
        ? {
            type: 'move',
            pageId: op.pageId,
            fromPath: op.fromPath,
            toPath: op.toPath,
          }
        : 'invalid';
    default:
      return op as CreatableOperationInput;
  }
};

export const normalizeCreateInput = (input: {
  readonly entry: unknown;
  readonly modelLabel?: unknown;
  readonly operations: unknown;
}):
  | { readonly ok: true; readonly value: NormalizedCreateInput }
  | { readonly ok: false; readonly rejection: CreateInputRejection } => {
  if (!isString(input.entry) || !CREATABLE_ENTRIES.includes(input.entry)) {
    return { ok: false, rejection: { code: 'invalid-entry' } };
  }
  const entry = input.entry as CreatableEntry;

  if (input.modelLabel != null) {
    // Code points, not UTF-16 units or graphemes (see tasks.md 5.1 note).
    if (
      !isString(input.modelLabel) ||
      Array.from(input.modelLabel).length > MODEL_LABEL_MAX_CODE_POINTS
    ) {
      return {
        ok: false,
        rejection: {
          code: 'model-label-too-long',
          max: MODEL_LABEL_MAX_CODE_POINTS,
        },
      };
    }
  }

  const rawOperations: readonly unknown[] = Array.isArray(input.operations)
    ? input.operations
    : [];
  const operations: CreatableOperationInput[] = [];
  for (const [index, raw] of rawOperations.entries()) {
    const normalized = normalizeOperation(raw);
    if (normalized === 'invalid') {
      return { ok: false, rejection: { code: 'invalid-operation', index } };
    }
    operations.push(normalized);
  }

  return {
    ok: true,
    value: {
      entry,
      ...(input.modelLabel == null
        ? {}
        : { modelLabel: input.modelLabel as string }),
      operations,
    },
  };
};
