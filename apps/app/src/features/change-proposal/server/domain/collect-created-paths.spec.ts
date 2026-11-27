import type { OperationRecord } from '../../interfaces';
import { collectCreatedPaths } from './collect-created-paths';

const base = { index: 0, status: 'applied' } as const;

describe('collectCreatedPaths', () => {
  it('maps the key of each create operation to the path it creates', () => {
    const operations: readonly OperationRecord[] = [
      { ...base, key: 'c1', type: 'create', path: '/new/a', body: 'b' },
      { ...base, key: 'c2', type: 'create', path: '/new/b', body: 'b' },
    ];

    const table = collectCreatedPaths(operations);

    expect([...table]).toEqual([
      ['c1', '/new/a'],
      ['c2', '/new/b'],
    ]);
  });

  it('takes no entry from edit, move or delete-completely operations', () => {
    const operations: readonly OperationRecord[] = [
      {
        ...base,
        key: 'e',
        type: 'edit',
        pageId: 'p1',
        baseRevisionId: 'r',
        body: 'b',
        appliedPagePath: '/edited',
      },
      {
        ...base,
        key: 'm',
        type: 'move',
        pageId: 'p2',
        fromPath: '/from',
        toPath: '/to',
      },
      {
        ...base,
        key: 'd',
        type: 'delete-completely',
        pageId: 'p3',
        expectedRevisionId: 'r',
      },
      { ...base, key: 'c', type: 'create', path: '/created', body: 'b' },
    ];

    const table = collectCreatedPaths(operations);

    expect([...table]).toEqual([['c', '/created']]);
  });

  it('accepts operations read with only their key, type and path', () => {
    const table = collectCreatedPaths([
      { key: 'c', type: 'create', path: '/created' },
      { key: 'e', type: 'edit', path: '/edited' },
    ]);

    expect([...table]).toEqual([['c', '/created']]);
  });
});
