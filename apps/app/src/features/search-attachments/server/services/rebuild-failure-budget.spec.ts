import type { ExtractionOutcome } from '~/features/search-attachments/interfaces/attachment-search';

import {
  createRebuildFailureBudget,
  outageFailureLimit,
  type RebuildItemResult,
} from './rebuild-failure-budget';

const success: ExtractionOutcome = {
  kind: 'success',
  pages: [],
  mimeType: 'text/plain',
};
const unreachable: ExtractionOutcome = { kind: 'serviceUnreachable' };
const busy: ExtractionOutcome = { kind: 'serviceBusy' };
const unreadable: ExtractionOutcome = {
  kind: 'failed',
  reasonCode: 'file_read_failed',
  message: 'The stored file could not be read',
};
const crashed: RebuildItemResult = { kind: 'unexpectedError' };
const brokenFile: ExtractionOutcome = {
  kind: 'failed',
  reasonCode: 'extraction_failed',
  message: 'broken',
};

/** Feeds the outcomes in order; the 1-based position of the first stop, or null. */
const stopsAt = (
  total: number,
  outcomes: RebuildItemResult[],
): number | null => {
  const budget = createRebuildFailureBudget(total);
  const index = outcomes.findIndex((outcome) => budget.record(outcome));
  return index === -1 ? null : index + 1;
};

describe('outageFailureLimit', () => {
  it.each([
    { total: 0, limit: 20 },
    { total: 10, limit: 21 },
    { total: 100, limit: 25 },
    { total: 1000, limit: 70 },
  ])('allows 20 plus 5% of $total attachments: stops at $limit', ({
    total,
    limit,
  }) => {
    expect(outageFailureLimit(total)).toBe(limit);
  });
});

describe('createRebuildFailureBudget', () => {
  it.each([
    { what: 'the extractor is unreachable', outage: unreachable },
    { what: 'the extractor is busy', outage: busy },
    { what: 'a stored file cannot be read', outage: unreadable },
    { what: 'an attachment ended in an exception', outage: crashed },
  ])('stops exactly when outage-like failures, counted over the whole run, reach the limit ($what)', ({
    outage,
  }) => {
    // 1000 attachments: the limit is 70, every 10th fails
    const outcomes = Array.from({ length: 1000 }, (_, i) =>
      i % 10 === 9 ? outage : success,
    );

    expect(stopsAt(1000, outcomes)).toBe(700);
  });

  it('keeps going while the failures stay under the limit', () => {
    const outcomes = Array.from({ length: 1000 }, (_, i) =>
      i % 15 === 14 ? unreachable : success,
    );

    expect(stopsAt(1000, outcomes)).toBeNull();
  });

  it('does not count failures that belong to the file itself', () => {
    expect(stopsAt(100, Array(100).fill(brokenFile))).toBeNull();
  });

  it('never stops a rebuild of fewer than 20 attachments mid-run, even if every one fails', () => {
    expect(stopsAt(19, Array(19).fill(unreachable))).toBeNull();
  });
});

describe('the verdict at the end of a run (shouldAbortAtEnd)', () => {
  const verdictAfter = (outcomes: RebuildItemResult[]): boolean => {
    const budget = createRebuildFailureBudget(outcomes.length);
    for (const outcome of outcomes) budget.record(outcome);
    return budget.shouldAbortAtEnd();
  };

  it('fails a run in which every outcome was outage-like', () => {
    expect(verdictAfter([unreachable, busy, unreadable, crashed])).toBe(true);
  });

  it.each([
    { what: 'one success', other: success },
    { what: 'an extractor verdict on the file', other: brokenFile },
    {
      what: 'an unsupported file',
      other: { kind: 'unsupported', mimeType: 'image/png' } as const,
    },
  ])('passes a run with $what among outage-like failures', ({ other }) => {
    expect(verdictAfter([unreachable, other, unreachable])).toBe(false);
  });

  it('passes a run that processed no attachment', () => {
    expect(verdictAfter([])).toBe(false);
  });
});
