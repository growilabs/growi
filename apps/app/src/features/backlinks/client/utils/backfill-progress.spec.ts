import {
  type BackfillProgressDisplay,
  type BackfillProgressInput,
  toBackfillProgressDisplay,
} from './backfill-progress';

// design.md, "Counts shown to the admin": the display absorbs a `processed` that drifts past or
// short of `runTotal`, so a run never reads as finished before it is, nor unfinished after.
describe('toBackfillProgressDisplay', () => {
  it.each<[string, BackfillProgressInput, BackfillProgressDisplay]>([
    [
      'a run partway through',
      { status: 'running', processed: 50, runTotal: 200, skippedPages: 0 },
      { processed: 50, runTotal: 200, percent: 25, skippedPages: 0 },
    ],
    [
      'a percent that is not whole (floored)',
      { status: 'running', processed: 2, runTotal: 3, skippedPages: 0 },
      { processed: 2, runTotal: 3, percent: 66, skippedPages: 0 },
    ],
    [
      'every counted page walked while still running',
      { status: 'running', processed: 150, runTotal: 150, skippedPages: 0 },
      { processed: 150, runTotal: 150, percent: 99, skippedPages: 0 },
    ],
    [
      'processed past runTotal while still running',
      { status: 'running', processed: 170, runTotal: 150, skippedPages: 0 },
      { processed: 150, runTotal: 150, percent: 99, skippedPages: 0 },
    ],
    [
      'processed past runTotal once complete',
      { status: 'complete', processed: 170, runTotal: 150, skippedPages: 0 },
      { processed: 150, runTotal: 150, percent: 100, skippedPages: 0 },
    ],
    [
      'processed short of runTotal once complete',
      { status: 'complete', processed: 140, runTotal: 150, skippedPages: 0 },
      { processed: 140, runTotal: 150, percent: 100, skippedPages: 0 },
    ],
    [
      'an empty range while running',
      { status: 'running', processed: 0, runTotal: 0, skippedPages: 0 },
      { processed: 0, runTotal: 0, percent: 0, skippedPages: 0 },
    ],
    [
      'an empty range once complete',
      { status: 'complete', processed: 0, runTotal: 0, skippedPages: 0 },
      { processed: 0, runTotal: 0, percent: 100, skippedPages: 0 },
    ],
    [
      'a request not yet claimed (no runTotal)',
      { status: 'requested', processed: 0, runTotal: null, skippedPages: 0 },
      { processed: 0, runTotal: 0, percent: 0, skippedPages: 0 },
    ],
    [
      'a stopped run',
      { status: 'stopped', processed: 30, runTotal: 120, skippedPages: 0 },
      { processed: 30, runTotal: 120, percent: 25, skippedPages: 0 },
    ],
    [
      'skipped pages, which stay out of the percent',
      { status: 'running', processed: 100, runTotal: 200, skippedPages: 40 },
      { processed: 100, runTotal: 200, percent: 50, skippedPages: 40 },
    ],
  ])('shows %s', (_label, input, expected) => {
    expect(toBackfillProgressDisplay(input)).toEqual(expected);
  });
});
