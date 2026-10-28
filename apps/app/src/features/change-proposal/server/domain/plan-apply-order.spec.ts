import type { OperationRecord } from '../../interfaces';
import { planApplyOrder } from './plan-apply-order';

const op = (
  index: number,
  type: 'edit' | 'create' | 'move' | 'delete-completely',
): OperationRecord => {
  const base = { index, key: `k${index}`, status: 'pending' as const };
  switch (type) {
    case 'edit':
      return {
        ...base,
        type,
        pageId: `p${index}`,
        baseRevisionId: 'r',
        body: 'b',
      };
    case 'create':
      return { ...base, type, path: `/c${index}`, body: 'b' };
    case 'move':
      return {
        ...base,
        type,
        pageId: `p${index}`,
        fromPath: '/a',
        toPath: '/b',
      };
    case 'delete-completely':
      return { ...base, type, pageId: `p${index}`, expectedRevisionId: 'r' };
  }
};

describe('planApplyOrder', () => {
  it('keeps the stored order when there is no move', () => {
    const ops = [op(0, 'edit'), op(1, 'create'), op(2, 'delete-completely')];
    expect(planApplyOrder(ops, [0, 1, 2])).toEqual([0, 1, 2]);
  });

  it('moves the move operation to the end', () => {
    const ops = [op(0, 'move'), op(1, 'edit'), op(2, 'create')];
    expect(planApplyOrder(ops, [0, 1, 2])).toEqual([1, 2, 0]);
  });

  it('keeps a move that is already last at the end', () => {
    const ops = [op(0, 'edit'), op(1, 'move')];
    expect(planApplyOrder(ops, [0, 1])).toEqual([0, 1]);
  });

  it('orders by stored order regardless of the order of targetIndices', () => {
    const ops = [op(0, 'edit'), op(1, 'create'), op(2, 'move')];
    expect(planApplyOrder(ops, [2, 1, 0])).toEqual([0, 1, 2]);
  });

  it('returns only the targeted operations', () => {
    const ops = [op(0, 'edit'), op(1, 'move'), op(2, 'create')];
    expect(planApplyOrder(ops, [1, 2])).toEqual([2, 1]);
  });

  it('returns only the move when only the move is targeted', () => {
    const ops = [op(0, 'edit'), op(1, 'move')];
    expect(planApplyOrder(ops, [1])).toEqual([1]);
  });

  it('ignores unknown indices and duplicates', () => {
    const ops = [op(0, 'edit'), op(1, 'create')];
    expect(planApplyOrder(ops, [1, 1, 9, 0])).toEqual([0, 1]);
  });

  it('returns an empty list for no targets or no operations', () => {
    expect(planApplyOrder([op(0, 'edit')], [])).toEqual([]);
    expect(planApplyOrder([], [0])).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const ops = [op(0, 'move'), op(1, 'edit')];
    const targets = [0, 1];
    planApplyOrder(ops, targets);
    expect(ops.map((o) => o.index)).toEqual([0, 1]);
    expect(targets).toEqual([0, 1]);
  });
});
