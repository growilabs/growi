import {
  type BackfillJobRow,
  toBacklinksBackfillState,
} from './backfill-admin-state';

const COVERED_SINCE = new Date('2026-03-01T00:00:00.000Z');

const job = (overrides: Partial<BackfillJobRow> = {}): BackfillJobRow => ({
  status: 'idle',
  stopRequested: false,
  processed: 0,
  runTotal: null,
  skippedPages: 0,
  coverage: 'none',
  coveredSince: null,
  completedAt: null,
  lastError: null,
  ...overrides,
});

const COUNTS = { notIncludedCount: 7, totalPageCount: 10 };

describe('toBacklinksBackfillState', () => {
  it('reports the progress, coverage and counts with dates as ISO strings', () => {
    const completedAt = new Date('2026-03-02T10:00:00.000Z');

    const state = toBacklinksBackfillState(
      job({
        status: 'stopped',
        processed: 40,
        runTotal: 100,
        skippedPages: 2,
        coverage: 'partial',
        coveredSince: COVERED_SINCE,
        completedAt,
        lastError: 'boom',
      }),
      COUNTS,
    );

    expect(state).toEqual({
      status: 'stopped',
      stopRequested: false,
      processed: 40,
      runTotal: 100,
      skippedPages: 2,
      coverage: 'partial',
      coveredSince: '2026-03-01T00:00:00.000Z',
      completedAt: '2026-03-02T10:00:00.000Z',
      lastError: 'boom',
      notIncludedCount: 7,
      totalPageCount: 10,
    });
  });

  it('never exposes the claim holder', () => {
    // The full stored row, as the route reads it.
    const row = {
      ...job({ status: 'running' }),
      claimedBy: 'host:123:uuid',
      leaseExpiresAt: new Date(),
    };

    const state = toBacklinksBackfillState(row, COUNTS);

    expect(state).not.toHaveProperty('claimedBy');
    expect(state).not.toHaveProperty('leaseExpiresAt');
  });

  it('reads a partial coverage without its boundary as none, as the run does', () => {
    const state = toBacklinksBackfillState(
      job({ coverage: 'partial', coveredSince: null }),
      COUNTS,
    );

    expect(state).toMatchObject({ coverage: 'none', coveredSince: null });
  });

  it('throws on a status the job never writes', () => {
    expect(() =>
      toBacklinksBackfillState(job({ status: 'paused' }), COUNTS),
    ).toThrow(/paused/);
  });
});
