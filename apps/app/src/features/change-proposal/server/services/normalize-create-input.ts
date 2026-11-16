import {
  type CreatableEntry,
  type CreatableOperationInput,
  MAX_PURPOSE_LENGTH,
  MAX_REVIEWERS,
  type ReviewerInput,
  type ReviewerKind,
} from '../../interfaces';
import { dedupeReviewerInputs, type InputRejection } from '../domain';

export const MODEL_LABEL_MAX_CODE_POINTS = 100;

const CREATABLE_ENTRIES: readonly string[] = [
  'ai-chat',
  'vault',
  'mcp',
] satisfies readonly CreatableEntry[];

const REVIEWER_KINDS: readonly string[] = [
  'user',
  'user-group',
  'external-user-group',
] satisfies readonly ReviewerKind[];

// Shape checks the domain validator relies on: it assumes string bodies and paths.
export type CreateInputRejection =
  | InputRejection
  | { readonly code: 'invalid-entry' }
  | { readonly code: 'model-label-too-long'; readonly max: number }
  | { readonly code: 'invalid-operation'; readonly index: number }
  | { readonly code: 'purpose-too-long'; readonly max: number }
  // index is absent when reviewers is not an array at all
  | { readonly code: 'invalid-reviewer'; readonly index?: number }
  | { readonly code: 'too-many-reviewers'; readonly max: number };

export type NormalizedCreateInput = {
  readonly entry: CreatableEntry;
  readonly modelLabel?: string;
  readonly purpose?: string;
  // Absent means "not given" (inherit or default); [] means "given as none".
  readonly reviewers?: readonly ReviewerInput[];
  readonly operations: readonly CreatableOperationInput[];
};

type Normalized<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly rejection: CreateInputRejection };

const isString = (value: unknown): value is string => typeof value === 'string';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null;

// Code points, not UTF-16 units or graphemes (see tasks.md 5.1 note).
const isWithinCodePoints = (value: unknown, max: number): value is string =>
  isString(value) && Array.from(value).length <= max;

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

const normalizeOperations = (
  value: unknown,
): Normalized<readonly CreatableOperationInput[]> => {
  const rawOperations: readonly unknown[] = Array.isArray(value) ? value : [];
  const operations: CreatableOperationInput[] = [];
  for (const [index, raw] of rawOperations.entries()) {
    const normalized = normalizeOperation(raw);
    if (normalized === 'invalid') {
      return { ok: false, rejection: { code: 'invalid-operation', index } };
    }
    operations.push(normalized);
  }
  return { ok: true, value: operations };
};

const normalizeReviewer = (raw: unknown): ReviewerInput | 'invalid' =>
  isRecord(raw) &&
  isString(raw.kind) &&
  REVIEWER_KINDS.includes(raw.kind) &&
  isString(raw.id)
    ? { kind: raw.kind as ReviewerKind, id: raw.id }
    : 'invalid';

// The limit applies after duplicates are collapsed: only distinct reviewers are stored.
const normalizeReviewers = (
  value: unknown,
): Normalized<readonly ReviewerInput[]> => {
  if (!Array.isArray(value)) {
    return { ok: false, rejection: { code: 'invalid-reviewer' } };
  }
  const reviewers: ReviewerInput[] = [];
  for (const [index, raw] of value.entries()) {
    const normalized = normalizeReviewer(raw);
    if (normalized === 'invalid') {
      return { ok: false, rejection: { code: 'invalid-reviewer', index } };
    }
    reviewers.push(normalized);
  }
  const distinct = dedupeReviewerInputs(reviewers);
  return distinct.length > MAX_REVIEWERS
    ? {
        ok: false,
        rejection: { code: 'too-many-reviewers', max: MAX_REVIEWERS },
      }
    : { ok: true, value: distinct };
};

const findTextRejection = (
  modelLabel: unknown,
  purpose: unknown,
): CreateInputRejection | null => {
  if (
    modelLabel != null &&
    !isWithinCodePoints(modelLabel, MODEL_LABEL_MAX_CODE_POINTS)
  ) {
    return { code: 'model-label-too-long', max: MODEL_LABEL_MAX_CODE_POINTS };
  }
  if (purpose != null && !isWithinCodePoints(purpose, MAX_PURPOSE_LENGTH)) {
    return { code: 'purpose-too-long', max: MAX_PURPOSE_LENGTH };
  }
  return null;
};

export const normalizeCreateInput = (input: {
  readonly entry: unknown;
  readonly modelLabel?: unknown;
  readonly purpose?: unknown;
  readonly reviewers?: unknown;
  readonly operations: unknown;
}): Normalized<NormalizedCreateInput> => {
  if (!isString(input.entry) || !CREATABLE_ENTRIES.includes(input.entry)) {
    return { ok: false, rejection: { code: 'invalid-entry' } };
  }
  const entry = input.entry as CreatableEntry;

  const { modelLabel, purpose } = input;
  const textRejection = findTextRejection(modelLabel, purpose);
  if (textRejection != null) {
    return { ok: false, rejection: textRejection };
  }

  const reviewers =
    input.reviewers == null ? null : normalizeReviewers(input.reviewers);
  if (reviewers != null && !reviewers.ok) {
    return reviewers;
  }

  const operations = normalizeOperations(input.operations);
  if (!operations.ok) {
    return operations;
  }

  return {
    ok: true,
    value: {
      entry,
      ...(modelLabel == null ? {} : { modelLabel: modelLabel as string }),
      ...(purpose == null ? {} : { purpose: purpose as string }),
      ...(reviewers == null ? {} : { reviewers: reviewers.value }),
      operations: operations.value,
    },
  };
};
