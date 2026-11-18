import type { OperationRecord, ViewerRole } from '../../interfaces';
import { toOperationView } from './to-operation-view';

const pendingEdit: OperationRecord = {
  index: 5,
  key: 'k1',
  status: 'pending',
  type: 'edit',
  pageId: 'page-1',
  baseRevisionId: 'rev-1',
  body: 'proposed body',
};

const decisions = {
  approval: {
    by: { id: 'u1', username: 'u1', name: 'U1' },
    at: '2026-01-01T00:00:00.000Z',
    channel: 'ui' as const,
    byRequester: false,
  },
  rejections: [
    {
      by: { id: 'u2', username: 'u2', name: 'U2' },
      at: '2026-01-01T00:01:00.000Z',
      comment: 'no',
    },
  ],
};

describe('toOperationView', () => {
  it('gives a reviewer the proposed body, the rank and whether the base is the latest on a decision target (Req 19.2)', () => {
    const view = toOperationView(pendingEdit, {
      role: 'reviewer',
      reviewTarget: { order: 1, baseIsLatest: false },
    });

    expect(view).toMatchObject({
      proposedBody: 'proposed body',
      baseRevisionId: 'rev-1',
      order: 1,
      baseIsLatest: false,
    });
    expect(view).not.toHaveProperty('index');
  });

  it('gives a reviewer no proposed body or rank on an operation that is not a decision target', () => {
    const view = toOperationView(
      { ...pendingEdit, status: 'applied' },
      { role: 'reviewer' },
    );

    expect(view).not.toHaveProperty('proposedBody');
    expect(view).not.toHaveProperty('order');
    expect(view).not.toHaveProperty('baseIsLatest');
  });

  it('gives the requester the original index as the order', () => {
    const view = toOperationView(pendingEdit, { role: 'requester' });

    expect(view).toMatchObject({
      index: 5,
      order: 5,
      proposedBody: 'proposed body',
    });
  });

  it.each<ViewerRole>([
    'requester',
    'reviewer',
  ])('gives the %s the decision records (Req 17.8, 19.7)', (role) => {
    expect(toOperationView(pendingEdit, { role, decisions })).toMatchObject(
      decisions,
    );
  });

  it('gives anyone else no decision records and no reviewer values, even if handed them', () => {
    const view = toOperationView(
      { ...pendingEdit, status: 'applied' },
      {
        role: 'other',
        decisions,
        reviewTarget: { order: 1, baseIsLatest: true },
      },
    );

    for (const field of [
      'approval',
      'rejections',
      'abstentions',
      'order',
      'baseIsLatest',
      'proposedBody',
      'index',
    ]) {
      expect(view).not.toHaveProperty(field);
    }
  });
});

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
      role: 'other',
      path: '/recorded',
    });

    expect(view.path).toBe('/recorded');
  });

  it.each([
    ['edit', edit],
    ['delete-completely', deleteCompletely],
  ] as const)('returns no path for a %s operation when none is supplied', (_, op) => {
    const view = toOperationView(op, { role: 'other' });

    expect(view).not.toHaveProperty('path');
  });

  it('keeps the path a create operation creates even when another is supplied', () => {
    const view = toOperationView(create, {
      role: 'other',
      path: '/recorded',
    });

    expect(view.path).toBe('/new');
  });

  it('returns no path for a move operation even when one is supplied', () => {
    const view = toOperationView(move, {
      role: 'other',
      path: '/recorded',
    });

    expect(view).not.toHaveProperty('path');
    expect(view).toMatchObject({ fromPath: '/from', toPath: '/to' });
  });
});
