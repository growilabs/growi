import {
  BACKFILL_PAGE_CONDITION,
  type BackfillCoverage,
  backfillPageFilter,
  coverageAfterRun,
  runRangeFor,
  toBackfillCoverage,
} from './backfill-range';

const JAN = new Date('2026-01-01T00:00:00Z');
const MAR = new Date('2026-03-01T00:00:00Z');
const JUN = new Date('2026-06-01T00:00:00Z');

const NONE: BackfillCoverage = { coverage: 'none' };
const ALL: BackfillCoverage = { coverage: 'all' };
const partialSince = (date: Date): BackfillCoverage => ({
  coverage: 'partial',
  coveredSince: date,
});

/*
 * A run's cutoff (null = all pages) is resolved from the admin's scope once at the first claim.
 * These tables are the contract between that cutoff, the stored coverage, the range the walk
 * visits, and the coverage recorded when the run completes.
 */
describe('backfill range and coverage', () => {
  describe.each<{
    name: string;
    runCutoff: Date | null;
    before: BackfillCoverage;
    range: ReturnType<typeof runRangeFor>;
    after: BackfillCoverage;
  }>([
    {
      name: 'all pages from no coverage walks everything and ends with all',
      runCutoff: null,
      before: NONE,
      range: { from: null, until: null },
      after: ALL,
    },
    {
      name: 'since a date from no coverage walks from that date and ends partial at it',
      runCutoff: MAR,
      before: NONE,
      range: { from: MAR, until: null },
      after: partialSince(MAR),
    },
    {
      name: 'a wider since after a partial run walks only the gap and lowers coveredSince',
      runCutoff: JAN,
      before: partialSince(MAR),
      range: { from: JAN, until: MAR },
      after: partialSince(JAN),
    },
    {
      name: 'all pages after a partial run walks the older gap and ends with all',
      runCutoff: null,
      before: partialSince(MAR),
      range: { from: null, until: MAR },
      after: ALL,
    },
    {
      name: 'a narrower since than the coverage is already covered',
      runCutoff: JUN,
      before: partialSince(MAR),
      range: null,
      after: partialSince(MAR),
    },
    {
      name: 'the same since as the coverage is already covered',
      runCutoff: MAR,
      before: partialSince(MAR),
      range: null,
      after: partialSince(MAR),
    },
    {
      name: 'any scope after full coverage is already covered',
      runCutoff: MAR,
      before: ALL,
      range: null,
      after: ALL,
    },
    {
      name: 'all pages after full coverage is already covered',
      runCutoff: null,
      before: ALL,
      range: null,
      after: ALL,
    },
  ])('$name', ({ runCutoff, before, range, after }) => {
    it('walks the expected range', () => {
      expect(runRangeFor(runCutoff, before)).toEqual(range);
    });

    it('records the expected coverage when the run completes', () => {
      expect(coverageAfterRun(runCutoff, before)).toEqual(after);
    });
  });

  describe('toBackfillCoverage', () => {
    it.each<[string, Date | null, BackfillCoverage]>([
      ['none', null, NONE],
      ['all', null, ALL],
      ['partial', MAR, partialSince(MAR)],
      // A partial coverage without its boundary says nothing usable; walking everything again is
      // the safe reading (the upsert is idempotent), skipping would hide pages.
      ['partial', null, NONE],
      ['something-else', null, NONE],
    ])('reads coverage %s with coveredSince %s', (coverage, coveredSince, expected) => {
      expect(toBackfillCoverage(coverage, coveredSince)).toEqual(expected);
    });
  });

  describe('backfillPageFilter', () => {
    it('applies the page condition and both bounds of the range', () => {
      expect(backfillPageFilter({ from: JAN, until: MAR })).toEqual({
        ...BACKFILL_PAGE_CONDITION,
        updatedAt: { $gte: JAN, $lt: MAR },
      });
    });

    it('omits an absent bound', () => {
      expect(backfillPageFilter({ from: JAN, until: null })).toEqual({
        ...BACKFILL_PAGE_CONDITION,
        updatedAt: { $gte: JAN },
      });
      expect(backfillPageFilter({ from: null, until: null })).toEqual(
        BACKFILL_PAGE_CONDITION,
      );
    });
  });
});
