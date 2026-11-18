import type { OperationRecord, OperationStatus } from '../../interfaces';
import { selectDecisionTargets } from './decision-targets';

type Spec =
  | { key: string; type: 'edit'; pageId: string; status?: OperationStatus }
  | { key: string; type: 'move'; pageId: string; status?: OperationStatus }
  | { key: string; type: 'create'; path: string; status?: OperationStatus };

const build = (specs: readonly Spec[]): OperationRecord[] =>
  specs.map((s, index) => {
    const base = { index, key: s.key, status: s.status ?? 'pending' };
    if (s.type === 'create') {
      return { ...base, type: 'create', path: s.path, body: 'b' };
    }
    if (s.type === 'move') {
      return {
        ...base,
        type: 'move',
        pageId: s.pageId,
        fromPath: '/from',
        toPath: '/hidden-parent/to',
      };
    }
    return {
      ...base,
      type: 'edit',
      pageId: s.pageId,
      baseRevisionId: 'r',
      body: 'b',
    };
  });

// The scope resolveReviewScope would return: visible keys, and the pending ones among them.
const scopeOf = (
  operations: readonly OperationRecord[],
  visibleKeys: readonly string[],
) => ({
  visibleKeys: new Set(visibleKeys),
  reviewTargetKeys: new Set(
    operations
      .filter((op) => visibleKeys.includes(op.key) && op.status === 'pending')
      .map((op) => op.key),
  ),
});

describe('selectDecisionTargets', () => {
  it('ignores a requested key on a page the viewer cannot see, as if it did not exist (Req 16.6)', () => {
    const operations = build([
      { key: 'shown', type: 'edit', pageId: 'p1' },
      { key: 'hidden', type: 'edit', pageId: 'p2' },
    ]);

    const targets = selectDecisionTargets(
      operations,
      scopeOf(operations, ['shown']),
      ['hidden', 'missing'],
    );

    expect(targets).toEqual({ requestedKeys: [], targetKeys: [] });
  });

  it('does not let a hidden key pull in a visible operation on the same page (Req 16.6)', () => {
    // The move is hidden (its destination parent is not viewable) while the edit on the same page is not.
    const operations = build([
      { key: 'edit', type: 'edit', pageId: 'p1' },
      { key: 'move', type: 'move', pageId: 'p1' },
    ]);

    const targets = selectDecisionTargets(
      operations,
      scopeOf(operations, ['edit']),
      ['move'],
    );

    expect(targets).toEqual({ requestedKeys: [], targetKeys: [] });
  });

  it('adds the other pending operations on a requested page, but only visible ones (Req 16.6)', () => {
    const operations = build([
      { key: 'edit', type: 'edit', pageId: 'p1' },
      { key: 'move', type: 'move', pageId: 'p1' },
      { key: 'second-edit', type: 'edit', pageId: 'p1' },
      { key: 'elsewhere', type: 'edit', pageId: 'p2' },
    ]);

    const targets = selectDecisionTargets(
      operations,
      scopeOf(operations, ['edit', 'second-edit', 'elsewhere']),
      ['edit'],
    );

    expect(targets).toEqual({
      requestedKeys: ['edit'],
      targetKeys: ['edit', 'second-edit'],
    });
  });

  it('reports a visible operation that is no longer pending without deciding it (Req 16.11)', () => {
    const operations = build([
      { key: 'applied', type: 'edit', pageId: 'p1', status: 'applied' },
      { key: 'pending', type: 'edit', pageId: 'p2' },
    ]);

    const targets = selectDecisionTargets(
      operations,
      scopeOf(operations, ['applied', 'pending']),
      ['pending', 'applied'],
    );

    expect(targets).toEqual({
      requestedKeys: ['applied', 'pending'],
      targetKeys: ['pending'],
    });
  });

  it('takes every visible pending operation and nothing hidden for the whole proposal (Req 16.2)', () => {
    const operations = build([
      { key: 'shown', type: 'edit', pageId: 'p1' },
      { key: 'hidden', type: 'edit', pageId: 'p2' },
      { key: 'skipped', type: 'edit', pageId: 'p3', status: 'skipped' },
      { key: 'new', type: 'create', path: '/a/new' },
    ]);

    const targets = selectDecisionTargets(
      operations,
      scopeOf(operations, ['shown', 'skipped', 'new']),
      'all',
    );

    expect(targets).toEqual({
      requestedKeys: ['shown', 'new'],
      targetKeys: ['shown', 'new'],
    });
  });
});
