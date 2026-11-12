import type { OperationRecord } from '../../interfaces';

/**
 * The path of an operation's page as recorded on the operation, for a page that
 * no longer exists. `createdPaths` is the original proposal's table built by
 * `collectCreatedPaths`, used for a delete-completely that reverts a create.
 */
export const recordedPathOf = (
  op: OperationRecord,
  createdPaths: ReadonlyMap<string, string>,
): string | undefined => {
  switch (op.type) {
    case 'create':
      return op.path;
    case 'move':
      return op.toPath;
    case 'edit':
      return op.appliedPagePath;
    case 'delete-completely':
      return op.revertTarget == null
        ? undefined
        : createdPaths.get(op.revertTarget.operationKey);
  }
};
