import type { OperationRecord } from '../../interfaces';
import { buildDecisionResponse } from './decision-response';

const edit = (
  index: number,
  fields: Partial<Pick<OperationRecord, 'status' | 'reason'>> = {},
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

describe('buildDecisionResponse', () => {
  it('answers the reported keys only, in operation order, with a null reason when there is none (Reviewers Req 2.6, 2.11)', () => {
    const operations = [
      edit(0, { status: 'skipped', reason: 'skipped-by-requester' }),
      edit(1),
      edit(2, { status: 'applied' }),
    ];

    expect(
      buildDecisionResponse(operations, new Set(['k1', 'k0', 'missing'])),
    ).toEqual({
      type: 'done',
      results: [
        { key: 'k0', status: 'skipped', reason: 'skipped-by-requester' },
        { key: 'k1', status: 'pending', reason: null },
      ],
    });
  });

  it('answers nothing for a decision that names no operation, such as a whole rejection', () => {
    expect(buildDecisionResponse([edit(0)], new Set())).toEqual({
      type: 'done',
      results: [],
    });
  });
});
