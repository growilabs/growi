import type { RevertCounterpartRecord } from '../models/change-proposal-types';
import {
  type RevertCounterpartSource,
  revertCounterpartFactsOf,
  revertCounterpartIdsOf,
} from './revert-counterparts';

const VIEWER = 'viewer';
const GONE = new Set(['p-gone']);

const originalOf = (requester: string): RevertCounterpartRecord => ({
  id: 'original',
  requester,
  operations: [
    { key: 'c1', type: 'create', path: '/created' },
    { key: 'e1', type: 'edit', path: '/edited' },
    { key: 'm1', type: 'move' },
  ],
});

const revertBy = (id: string, requester: string): RevertCounterpartRecord => ({
  id,
  requester,
  operations: [],
});

const counterpartsOf = (
  records: readonly RevertCounterpartRecord[],
): ReadonlyMap<string, RevertCounterpartRecord> =>
  new Map(records.map((record) => [record.id, record]));

const revertProposal: RevertCounterpartSource = {
  revertOf: 'original',
  operations: [{ type: 'delete-completely', status: 'applied', pageId: 'p1' }],
};

const reverted = (
  pageId: string,
  revertedByProposalId: string,
): RevertCounterpartSource['operations'][number] => ({
  type: 'edit',
  status: 'reverted',
  pageId,
  revertedByProposalId,
});

describe('revertCounterpartIdsOf', () => {
  it('collects every revert’s original and the revert of each operation whose page is gone, once each', () => {
    const ids = revertCounterpartIdsOf(
      [
        revertProposal,
        { revertOf: 'original', operations: [] },
        {
          operations: [
            reverted('p-gone', 'r1'),
            reverted('p-gone', 'r1'),
            { ...reverted('p-gone', 'r2'), type: 'create', pageId: undefined },
          ],
        },
      ],
      GONE,
    );

    expect(ids).toEqual(['original', 'r1']);
  });

  it('leaves out the revert of an operation whose page still exists', () => {
    expect(
      revertCounterpartIdsOf(
        [{ operations: [reverted('p-alive', 'r1')] }],
        GONE,
      ),
    ).toEqual([]);
  });

  it('takes a create’s page from its result page', () => {
    expect(
      revertCounterpartIdsOf(
        [
          {
            operations: [
              {
                type: 'create',
                status: 'reverted',
                resultPageId: 'p-gone',
                revertedByProposalId: 'r1',
              },
            ],
          },
        ],
        GONE,
      ),
    ).toEqual(['r1']);
  });
});

describe('revertCounterpartFactsOf', () => {
  it('marks the requester of a revert’s original and gives the original’s create paths', () => {
    const facts = revertCounterpartFactsOf(
      revertProposal,
      VIEWER,
      counterpartsOf([originalOf(VIEWER)]),
      GONE,
    );

    expect(facts.isOriginalRequester).toBe(true);
    expect([...facts.revertProposalIdsByViewer]).toEqual([]);
    expect([...facts.createdPaths]).toEqual([['c1', '/created']]);
  });

  it('gives a viewer who did not request the original the create paths but not the role', () => {
    const facts = revertCounterpartFactsOf(
      revertProposal,
      VIEWER,
      counterpartsOf([originalOf('someone-else')]),
      GONE,
    );

    expect(facts.isOriginalRequester).toBe(false);
    expect([...facts.createdPaths]).toEqual([['c1', '/created']]);
  });

  it('names only the viewer’s own reverts of operations whose page is gone', () => {
    const facts = revertCounterpartFactsOf(
      {
        operations: [
          reverted('p-gone', 'mine'),
          reverted('p-gone', 'theirs'),
          reverted('p-alive', 'mine-alive'),
        ],
      },
      VIEWER,
      counterpartsOf([
        revertBy('mine', VIEWER),
        revertBy('theirs', 'someone-else'),
        revertBy('mine-alive', VIEWER),
      ]),
      GONE,
    );

    expect(facts.isOriginalRequester).toBe(false);
    expect([...facts.revertProposalIdsByViewer]).toEqual(['mine']);
    expect(facts.createdPaths.size).toBe(0);
  });

  it('gives empty values when the counterparts could not be read', () => {
    const facts = revertCounterpartFactsOf(
      { ...revertProposal, operations: [reverted('p-gone', 'r1')] },
      VIEWER,
      new Map(),
      GONE,
    );

    expect(facts.isOriginalRequester).toBe(false);
    expect(facts.revertProposalIdsByViewer.size).toBe(0);
    expect(facts.createdPaths.size).toBe(0);
  });
});
