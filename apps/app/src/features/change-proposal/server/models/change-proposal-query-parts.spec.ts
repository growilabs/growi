import { toOutcomeData } from './change-proposal-query-parts';

const PAGE_ID = '65f000000000000000000003';
const REVISION_ID = '65f000000000000000000004';
const NOW = new Date('2026-10-01T00:00:00Z');

describe('toOutcomeData', () => {
  it('writes the page path at apply time onto the operation path when the applied outcome has one', () => {
    const data = toOutcomeData(
      {
        status: 'applied',
        resultPageId: PAGE_ID,
        resultRevisionId: REVISION_ID,
        appliedPagePath: '/applied/日本語　パス',
      },
      NOW,
    );

    expect(data).toStrictEqual({
      status: 'applied',
      reason: { unset: true },
      appliedAt: NOW,
      resultPageId: PAGE_ID,
      resultRevisionId: REVISION_ID,
      path: '/applied/日本語　パス',
    });
  });

  it('leaves the operation path untouched when the applied outcome has no page path', () => {
    const data = toOutcomeData(
      { status: 'applied', resultPageId: PAGE_ID, resultRevisionId: null },
      NOW,
    );

    expect(data).toStrictEqual({
      status: 'applied',
      reason: { unset: true },
      appliedAt: NOW,
      resultPageId: PAGE_ID,
    });
  });

  it('never writes a path for an outcome that is not applied', () => {
    expect(
      toOutcomeData({ status: 'stale', reason: 'base-revision-changed' }, NOW),
    ).not.toHaveProperty('path');
  });
});
