import type { OperationType } from '../../interfaces';

// Narrow on purpose: rows read with only these fields are accepted as well as
// full operation records.
type CreatedPathSource = {
  readonly key: string;
  readonly type: OperationType;
  readonly path?: string;
};

export const collectCreatedPaths = (
  operations: readonly CreatedPathSource[],
): ReadonlyMap<string, string> =>
  new Map(
    operations.flatMap((op) =>
      op.type === 'create' && op.path != null
        ? [[op.key, op.path] as const]
        : [],
    ),
  );
