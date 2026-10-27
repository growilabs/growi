import type { OperationRecord, OperationStatus } from '../../interfaces';
import { expandApprovalTargets } from './expand-approval-targets';

type Spec =
  | { index: number; type: 'edit' | 'move' | 'trash'; pageId: string }
  | { index: number; type: 'create'; path: string };

const build = (
  specs: Spec[],
  statuses: Record<number, OperationStatus> = {},
): OperationRecord[] =>
  specs.map((s) => {
    const base = {
      index: s.index,
      key: `k${s.index}`,
      status: statuses[s.index] ?? ('pending' as OperationStatus),
    };
    if (s.type === 'create') {
      return { ...base, type: s.type, path: s.path, body: 'b' };
    }
    if (s.type === 'edit') {
      return {
        ...base,
        type: s.type,
        pageId: s.pageId,
        baseRevisionId: 'r',
        body: 'b',
      };
    }
    if (s.type === 'move') {
      return {
        ...base,
        type: s.type,
        pageId: s.pageId,
        fromPath: '/a',
        toPath: '/b',
      };
    }
    return {
      ...base,
      type: s.type,
      pageId: s.pageId,
      expectedRevisionId: 'r',
    };
  });

describe('expandApprovalTargets', () => {
  it("returns every pending operation for 'all'", () => {
    const ops = build(
      [
        { index: 0, type: 'edit', pageId: 'p1' },
        { index: 1, type: 'create', path: '/x' },
        { index: 2, type: 'edit', pageId: 'p2' },
      ],
      { 1: 'applied', 2: 'skipped' },
    );
    expect(expandApprovalTargets(ops, 'all')).toEqual([0]);
  });

  it('expands an edit to the move of the same page id', () => {
    const ops = build([
      { index: 0, type: 'edit', pageId: 'p1' },
      { index: 1, type: 'edit', pageId: 'p2' },
      { index: 2, type: 'move', pageId: 'p1' },
    ]);
    expect(expandApprovalTargets(ops, [0])).toEqual([0, 2]);
  });

  it('expands a move to the edit of the same page id', () => {
    const ops = build([
      { index: 0, type: 'edit', pageId: 'p1' },
      { index: 1, type: 'move', pageId: 'p1' },
    ]);
    expect(expandApprovalTargets(ops, [1])).toEqual([0, 1]);
  });

  it('expands creates by path, not by page id', () => {
    const ops = build([
      { index: 0, type: 'create', path: '/x' },
      { index: 1, type: 'create', path: '/x' },
      { index: 2, type: 'create', path: '/y' },
      { index: 3, type: 'edit', pageId: '/x' },
    ]);
    expect(expandApprovalTargets(ops, [0])).toEqual([0, 1]);
  });

  it('leaves operations on other pages unapproved', () => {
    const ops = build([
      { index: 0, type: 'edit', pageId: 'p1' },
      { index: 1, type: 'edit', pageId: 'p2' },
    ]);
    expect(expandApprovalTargets(ops, [1])).toEqual([1]);
  });

  it('returns only pending operations of the page', () => {
    const ops = build(
      [
        { index: 0, type: 'edit', pageId: 'p1' },
        { index: 1, type: 'move', pageId: 'p1' },
        { index: 2, type: 'trash', pageId: 'p1' },
      ],
      { 1: 'applied', 2: 'failed' },
    );
    expect(expandApprovalTargets(ops, [0])).toEqual([0]);
  });

  it('returns a sorted, de-duplicated list for several chosen operations', () => {
    const ops = build([
      { index: 0, type: 'edit', pageId: 'p1' },
      { index: 1, type: 'edit', pageId: 'p2' },
      { index: 2, type: 'move', pageId: 'p1' },
    ]);
    expect(expandApprovalTargets(ops, [2, 0, 1, 1])).toEqual([0, 1, 2]);
  });

  it('ignores unknown indices and returns nothing for an empty choice', () => {
    const ops = build([{ index: 0, type: 'edit', pageId: 'p1' }]);
    expect(expandApprovalTargets(ops, [9])).toEqual([]);
    expect(expandApprovalTargets(ops, [])).toEqual([]);
  });

  it('returns nothing for no operations', () => {
    expect(expandApprovalTargets([], 'all')).toEqual([]);
  });
});
