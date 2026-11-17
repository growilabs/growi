import type { OperationRecord } from '../../interfaces';
import { buildApproveResponse, keysApprovedBy } from './approve-response';

const edit = (
  index: number,
  fields: Partial<
    Pick<OperationRecord, 'status' | 'reason' | 'decisionToken'>
  > = {},
): OperationRecord => ({
  index,
  key: `k${index}`,
  type: 'edit',
  pageId: `p${index}`,
  baseRevisionId: 'r',
  body: 'b',
  status: 'pending',
  ...fields,
});

describe('keysApprovedBy', () => {
  it('takes only the operations carrying this request’s token, not another request’s', () => {
    const operations = [
      edit(0, { decisionToken: 'mine' }),
      edit(1, { decisionToken: 'theirs' }),
      edit(2),
      edit(3, { decisionToken: 'mine' }),
    ];

    expect(keysApprovedBy(operations, 'mine')).toEqual(['k0', 'k3']);
  });
});

describe('buildApproveResponse', () => {
  it('reports only the reported keys although the apply ran others too (Reviewers Req 2.6, 5.6)', () => {
    const operations = [
      edit(0, { status: 'applied' }),
      edit(1, { status: 'applied' }),
    ];

    expect(
      buildApproveResponse(operations, new Set(['k0']), {
        type: 'done',
        results: [
          { key: 'k0', status: 'applied' },
          { key: 'k1', status: 'applied' },
        ],
      }),
    ).toEqual({ type: 'done', results: [{ key: 'k0', status: 'applied' }] });
  });

  it('answers a key the apply did not handle with its state as read, keeping operation order (Reviewers Req 2.11)', () => {
    const operations = [
      edit(0, { status: 'skipped', reason: 'skipped-by-requester' }),
      edit(1, { status: 'pending', reason: 'page-being-edited' }),
    ];

    expect(
      buildApproveResponse(operations, new Set(['k1', 'k0']), {
        type: 'done',
        results: [
          { key: 'k1', status: 'pending', reason: 'page-being-edited' },
        ],
      }),
    ).toEqual({
      type: 'done',
      results: [
        { key: 'k0', status: 'skipped', reason: 'skipped-by-requester' },
        { key: 'k1', status: 'pending', reason: 'page-being-edited' },
      ],
    });
  });

  it('answers with the states as read when nothing was applied', () => {
    expect(
      buildApproveResponse(
        [edit(0, { status: 'applied' })],
        new Set(['k0']),
        null,
      ),
    ).toEqual({ type: 'done', results: [{ key: 'k0', status: 'applied' }] });
  });

  it('adds the reported states to an in-progress answer (Reviewers Req 2.5)', () => {
    expect(
      buildApproveResponse(
        [edit(0), edit(1, { status: 'applied' })],
        new Set(['k0']),
        { type: 'in-progress' },
      ),
    ).toEqual({
      type: 'in-progress',
      results: [{ key: 'k0', status: 'pending' }],
    });
  });
});
