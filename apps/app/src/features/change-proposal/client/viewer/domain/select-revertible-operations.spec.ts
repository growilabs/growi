import type { OperationView } from '../../../interfaces';
import { selectRevertibleOperations } from './select-revertible-operations';

const operation = (
  key: string,
  revertability?: OperationView['revertability'],
): OperationView => ({
  key,
  type: 'edit',
  status: 'applied',
  ...(revertability != null ? { revertability } : {}),
});

describe('selectRevertibleOperations', () => {
  it('keeps only operations judged revertible', () => {
    const operations = [
      operation('a', { revertible: true }),
      operation('b', { revertible: false, reason: 'edited-after-apply' }),
      operation('c'),
      operation('d', { revertible: true }),
    ];

    const result = selectRevertibleOperations(operations);

    expect(result.map((o) => o.key)).toEqual(['a', 'd']);
  });

  it('does not select operations that have no judgement', () => {
    expect(
      selectRevertibleOperations([operation('a'), operation('b')]),
    ).toEqual([]);
  });

  it('does not select operations judged not revertible', () => {
    const operations = [
      operation('a', { revertible: false, reason: 'has-children' }),
    ];

    expect(selectRevertibleOperations(operations)).toEqual([]);
  });

  it('returns an empty list for empty input', () => {
    expect(selectRevertibleOperations([])).toEqual([]);
  });

  it('preserves the input order', () => {
    const operations = [
      operation('z', { revertible: true }),
      operation('m', { revertible: true }),
      operation('a', { revertible: true }),
    ];

    expect(selectRevertibleOperations(operations).map((o) => o.key)).toEqual([
      'z',
      'm',
      'a',
    ]);
  });

  it('does not mutate the input', () => {
    const operations = Object.freeze([
      operation('a', { revertible: true }),
      operation('b'),
    ]);

    const result = selectRevertibleOperations(operations);

    expect(operations.map((o) => o.key)).toEqual(['a', 'b']);
    expect(result).not.toBe(operations);
  });
});
