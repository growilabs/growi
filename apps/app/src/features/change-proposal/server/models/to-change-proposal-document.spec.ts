import type {
  ChangeproposalsOperations,
  changeproposals,
} from '~/generated/prisma/client';

import {
  toChangeProposalDocument,
  toChangeProposalSummary,
} from './to-change-proposal-document';

const PROPOSAL_ID = '65f000000000000000000001';
const REQUESTER_ID = '65f000000000000000000002';
const PAGE_ID = '65f000000000000000000003';
const REVISION_ID = '65f000000000000000000004';
const CREATED_AT = new Date('2026-10-01T00:00:00Z');

const emptyOperation: ChangeproposalsOperations = {
  index: 0,
  key: 'k-0',
  type: 'edit',
  status: 'pending',
  reason: null,
  pageId: null,
  baseRevisionId: null,
  expectedRevisionId: null,
  body: null,
  path: null,
  fromPath: null,
  toPath: null,
  removeRedirectsFrom: null,
  approvedAt: null,
  appliedAt: null,
  resultPageId: null,
  resultRevisionId: null,
  revertTarget: null,
  revertedByProposalId: null,
  revertedAt: null,
};

const operationRow = (
  fields: Partial<ChangeproposalsOperations>,
): ChangeproposalsOperations => ({ ...emptyOperation, ...fields });

const proposalRow = (fields: Partial<changeproposals>): changeproposals => ({
  id: PROPOSAL_ID,
  v: 0,
  requester: REQUESTER_ID,
  entry: 'ai-chat',
  modelLabel: null,
  revertOf: null,
  basedOn: null,
  lifecycle: 'open',
  operations: [],
  appliedPageIds: [],
  lastAppliedAt: null,
  applyLease: null,
  expiresAt: null,
  perPageNotifications: true,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  ...fields,
});

describe('toChangeProposalDocument', () => {
  it('maps the proposal fields and drops absent optional values', () => {
    const doc = toChangeProposalDocument(proposalRow({}));

    expect(doc).toStrictEqual({
      _id: PROPOSAL_ID,
      requester: REQUESTER_ID,
      entry: 'ai-chat',
      lifecycle: 'open',
      operations: [],
      appliedPageIds: [],
      perPageNotifications: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it('maps an edit operation', () => {
    const doc = toChangeProposalDocument(
      proposalRow({
        operations: [
          operationRow({
            type: 'edit',
            pageId: PAGE_ID,
            baseRevisionId: REVISION_ID,
            body: 'new body',
            reason: 'page-being-edited',
          }),
        ],
      }),
    );

    expect(doc.operations).toStrictEqual([
      {
        type: 'edit',
        pageId: PAGE_ID,
        baseRevisionId: REVISION_ID,
        body: 'new body',
        index: 0,
        key: 'k-0',
        status: 'pending',
        reason: 'page-being-edited',
      },
    ]);
  });

  it('reads the path stored on an applied edit as the page path at apply time', () => {
    const doc = toChangeProposalDocument(
      proposalRow({
        operations: [
          operationRow({
            type: 'edit',
            status: 'applied',
            pageId: PAGE_ID,
            baseRevisionId: REVISION_ID,
            body: 'new body',
            path: '/applied/日本語　パス',
          }),
        ],
      }),
    );

    expect(doc.operations).toStrictEqual([
      {
        type: 'edit',
        pageId: PAGE_ID,
        baseRevisionId: REVISION_ID,
        body: 'new body',
        index: 0,
        key: 'k-0',
        status: 'applied',
        appliedPagePath: '/applied/日本語　パス',
      },
    ]);
  });

  it('maps a create operation', () => {
    const doc = toChangeProposalDocument(
      proposalRow({
        operations: [
          operationRow({ type: 'create', path: '/new', body: 'body' }),
        ],
      }),
    );

    expect(doc.operations[0]).toStrictEqual({
      type: 'create',
      path: '/new',
      body: 'body',
      index: 0,
      key: 'k-0',
      status: 'pending',
    });
  });

  it('maps a move operation with and without removeRedirectsFrom', () => {
    const doc = toChangeProposalDocument(
      proposalRow({
        operations: [
          operationRow({
            type: 'move',
            pageId: PAGE_ID,
            fromPath: '/a',
            toPath: '/b',
          }),
          operationRow({
            index: 1,
            key: 'k-1',
            type: 'move',
            pageId: PAGE_ID,
            fromPath: '/b',
            toPath: '/a',
            removeRedirectsFrom: '/a',
          }),
        ],
      }),
    );

    expect(doc.operations[0]).toStrictEqual({
      type: 'move',
      pageId: PAGE_ID,
      fromPath: '/a',
      toPath: '/b',
      index: 0,
      key: 'k-0',
      status: 'pending',
    });
    expect(doc.operations[1]).toMatchObject({
      type: 'move',
      removeRedirectsFrom: '/a',
    });
  });

  it('maps delete-completely operations of a revert proposal with their revert targets', () => {
    const revertedAt = new Date('2026-10-02T00:00:00Z');
    const doc = toChangeProposalDocument(
      proposalRow({
        entry: 'revert',
        revertOf: '65f0000000000000000000aa',
        operations: [
          operationRow({
            type: 'delete-completely',
            pageId: PAGE_ID,
            expectedRevisionId: REVISION_ID,
            revertTarget: {
              proposalId: '65f0000000000000000000aa',
              operationKey: 'orig-0',
            },
          }),
          operationRow({
            index: 1,
            key: 'k-1',
            type: 'delete-completely',
            status: 'applied',
            pageId: PAGE_ID,
            expectedRevisionId: REVISION_ID,
            appliedAt: revertedAt,
            resultPageId: PAGE_ID,
            revertTarget: {
              proposalId: '65f0000000000000000000aa',
              operationKey: 'orig-1',
            },
          }),
        ],
      }),
    );

    expect(doc.revertOf).toBe('65f0000000000000000000aa');
    expect(doc.operations[0]).toStrictEqual({
      type: 'delete-completely',
      pageId: PAGE_ID,
      expectedRevisionId: REVISION_ID,
      index: 0,
      key: 'k-0',
      status: 'pending',
      revertTarget: {
        proposalId: '65f0000000000000000000aa',
        operationKey: 'orig-0',
      },
    });
    expect(doc.operations[1]).toStrictEqual({
      type: 'delete-completely',
      pageId: PAGE_ID,
      expectedRevisionId: REVISION_ID,
      index: 1,
      key: 'k-1',
      status: 'applied',
      appliedAt: revertedAt,
      resultPageId: PAGE_ID,
      revertTarget: {
        proposalId: '65f0000000000000000000aa',
        operationKey: 'orig-1',
      },
    });
  });

  it('maps basedOn and the settled lifecycle', () => {
    const doc = toChangeProposalDocument(
      proposalRow({
        lifecycle: 'settled',
        basedOn: {
          proposalId: '65f0000000000000000000bb',
          relation: 'rework',
          operationKeys: ['a', 'b'],
        },
      }),
    );

    expect(doc.lifecycle).toBe('settled');
    expect(doc.basedOn).toStrictEqual({
      proposalId: '65f0000000000000000000bb',
      relation: 'rework',
      operationKeys: ['a', 'b'],
    });
  });

  it('keeps the apply lease and the applied-at bookkeeping', () => {
    const at = new Date('2026-10-03T00:00:00Z');
    const doc = toChangeProposalDocument(
      proposalRow({
        modelLabel: 'model-x',
        appliedPageIds: [PAGE_ID],
        lastAppliedAt: at,
        applyLease: { token: 't', expiresAt: at },
        expiresAt: at,
        perPageNotifications: false,
      }),
    );

    expect(doc).toMatchObject({
      modelLabel: 'model-x',
      appliedPageIds: [PAGE_ID],
      lastAppliedAt: at,
      applyLease: { token: 't', expiresAt: at },
      expiresAt: at,
      perPageNotifications: false,
    });
  });

  it.each([
    [
      'edit without baseRevisionId',
      { type: 'edit', pageId: PAGE_ID, body: 'b' },
    ],
    [
      'edit without body',
      { type: 'edit', pageId: PAGE_ID, baseRevisionId: REVISION_ID },
    ],
    ['create without path', { type: 'create', body: 'b' }],
    ['move without toPath', { type: 'move', pageId: PAGE_ID, fromPath: '/a' }],
    [
      'delete-completely without expectedRevisionId',
      { type: 'delete-completely', pageId: PAGE_ID },
    ],
  ] satisfies [
    string,
    Partial<ChangeproposalsOperations>,
  ][])('throws for an operation row missing a required field: %s', (_label, fields) => {
    expect(() =>
      toChangeProposalDocument(
        proposalRow({ operations: [operationRow(fields)] }),
      ),
    ).toThrow();
  });

  it.each([
    [
      'operation type',
      proposalRow({
        operations: [operationRow({ type: 'delete', pageId: PAGE_ID })],
      }),
    ],
    [
      'operation status',
      proposalRow({
        operations: [
          operationRow({
            type: 'create',
            path: '/x',
            body: 'b',
            status: 'done',
          }),
        ],
      }),
    ],
    [
      'operation reason',
      proposalRow({
        operations: [
          operationRow({
            type: 'create',
            path: '/x',
            body: 'b',
            reason: 'because',
          }),
        ],
      }),
    ],
    ['lifecycle', proposalRow({ lifecycle: 'closed' })],
    ['entry', proposalRow({ entry: 'web' })],
    [
      'basedOn relation',
      proposalRow({
        basedOn: {
          proposalId: PROPOSAL_ID,
          relation: 'retry',
          operationKeys: ['a'],
        },
      }),
    ],
  ])('throws for an unknown %s', (_label, row) => {
    expect(() => toChangeProposalDocument(row)).toThrow();
  });
});

describe('toChangeProposalSummary', () => {
  it('maps operations without requiring the body', () => {
    const { body: _body, ...editWithoutBody } = operationRow({
      type: 'edit',
      pageId: PAGE_ID,
      baseRevisionId: REVISION_ID,
    });

    const summary = toChangeProposalSummary({
      ...proposalRow({}),
      operations: [editWithoutBody],
    });

    expect(summary.operations).toStrictEqual([
      {
        type: 'edit',
        pageId: PAGE_ID,
        baseRevisionId: REVISION_ID,
        index: 0,
        key: 'k-0',
        status: 'pending',
      },
    ]);
  });

  it('reads the path stored on an edit as appliedPagePath and keeps a create path as its target path', () => {
    const { body: _editBody, ...editWithoutBody } = operationRow({
      type: 'edit',
      status: 'applied',
      pageId: PAGE_ID,
      baseRevisionId: REVISION_ID,
      path: '/applied',
    });
    const { body: _createBody, ...createWithoutBody } = operationRow({
      index: 1,
      key: 'k-1',
      type: 'create',
      path: '/new',
    });

    const summary = toChangeProposalSummary({
      ...proposalRow({}),
      operations: [editWithoutBody, createWithoutBody],
    });

    expect(summary.operations).toStrictEqual([
      {
        type: 'edit',
        pageId: PAGE_ID,
        baseRevisionId: REVISION_ID,
        index: 0,
        key: 'k-0',
        status: 'applied',
        appliedPagePath: '/applied',
      },
      {
        type: 'create',
        path: '/new',
        index: 1,
        key: 'k-1',
        status: 'pending',
      },
    ]);
  });
});
