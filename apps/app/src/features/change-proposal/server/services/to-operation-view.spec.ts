import { toOperationView } from './to-operation-view';

const base = { index: 0, key: 'k', status: 'applied' } as const;

const edit = {
  ...base,
  type: 'edit',
  pageId: 'p',
  baseRevisionId: 'r',
  body: 'b',
} as const;
const deleteCompletely = {
  ...base,
  type: 'delete-completely',
  pageId: 'p',
  expectedRevisionId: 'r',
} as const;
const create = { ...base, type: 'create', path: '/new', body: 'b' } as const;
const move = {
  ...base,
  type: 'move',
  pageId: 'p',
  fromPath: '/from',
  toPath: '/to',
} as const;

describe('toOperationView path', () => {
  it.each([
    ['edit', edit],
    ['delete-completely', deleteCompletely],
  ] as const)('returns the supplied path for a %s operation', (_, op) => {
    const view = toOperationView(op, {
      isRequester: false,
      path: '/recorded',
    });

    expect(view.path).toBe('/recorded');
  });

  it.each([
    ['edit', edit],
    ['delete-completely', deleteCompletely],
  ] as const)('returns no path for a %s operation when none is supplied', (_, op) => {
    const view = toOperationView(op, { isRequester: false });

    expect(view).not.toHaveProperty('path');
  });

  it('keeps the path a create operation creates even when another is supplied', () => {
    const view = toOperationView(create, {
      isRequester: false,
      path: '/recorded',
    });

    expect(view.path).toBe('/new');
  });

  it('returns no path for a move operation even when one is supplied', () => {
    const view = toOperationView(move, {
      isRequester: false,
      path: '/recorded',
    });

    expect(view).not.toHaveProperty('path');
    expect(view).toMatchObject({ fromPath: '/from', toPath: '/to' });
  });
});
