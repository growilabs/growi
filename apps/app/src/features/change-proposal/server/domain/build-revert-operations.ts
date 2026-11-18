import type {
  OperationRecord,
  ProposalMark,
  RevertOperationInput,
} from '../../interfaces';

export type RevertibleOperationFacts = {
  readonly key: string;
  readonly originalBody?: string;
};

const required = <T>(value: T | undefined, what: string, key: string): T => {
  if (value == null) {
    throw new Error(`Cannot build a revert for operation ${key}: ${what}`);
  }
  return value;
};

const toRevertOperation = (
  op: OperationRecord,
  facts: RevertibleOperationFacts,
  revertTarget: ProposalMark,
): RevertOperationInput => {
  switch (op.type) {
    case 'edit':
      return {
        type: 'edit',
        pageId: op.pageId,
        baseRevisionId: required(
          op.resultRevisionId,
          'missing resultRevisionId',
          op.key,
        ),
        body: required(facts.originalBody, 'missing originalBody', op.key),
        revertTarget,
      };
    case 'create':
      return {
        type: 'delete-completely',
        pageId: required(op.resultPageId, 'missing resultPageId', op.key),
        expectedRevisionId: required(
          op.resultRevisionId,
          'missing resultRevisionId',
          op.key,
        ),
        revertTarget,
      };
    case 'move':
      return {
        type: 'move',
        pageId: op.pageId,
        fromPath: op.toPath,
        toPath: op.fromPath,
        removeRedirectsFrom: op.fromPath,
        revertTarget,
      };
    case 'delete-completely':
      throw new Error(
        `Operation ${op.key} is a complete deletion, which cannot be reverted`,
      );
    default: {
      const unreachable: never = op;
      throw new Error(`Unknown operation: ${JSON.stringify(unreachable)}`);
    }
  }
};

// Output follows the target's stored order so it never depends on how the caller ordered `revertible`.
export const buildRevertOperations = (
  target: {
    readonly proposalId: string;
    readonly operations: readonly OperationRecord[];
  },
  revertible: readonly RevertibleOperationFacts[],
): readonly RevertOperationInput[] => {
  const factsByKey = new Map(revertible.map((facts) => [facts.key, facts]));
  const knownKeys = new Set(target.operations.map((op) => op.key));
  const unknownKey = revertible.find((facts) => !knownKeys.has(facts.key));
  if (unknownKey != null) {
    throw new Error(
      `Operation ${unknownKey.key} is not in proposal ${target.proposalId}`,
    );
  }

  return target.operations.flatMap((op) => {
    const facts = factsByKey.get(op.key);
    if (facts == null) return [];
    return [
      toRevertOperation(op, facts, {
        proposalId: target.proposalId,
        operationKey: op.key,
      }),
    ];
  });
};
