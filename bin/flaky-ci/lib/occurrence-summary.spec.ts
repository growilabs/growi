import { describe, expect, it } from 'vitest';

import {
  computeOccurrenceSummary,
  type DashboardIssue,
} from './occurrence-summary.ts';

const issue = (overrides: Partial<DashboardIssue> = {}): DashboardIssue => ({
  number: 1,
  title: 'flaky: vitest:src/a.integ.ts:does a thing',
  labels: ['flaky/confirmed'],
  body: '### First observation\n\n- Date: 2026-09-01T00:00:00Z\n',
  comments: [],
  ...overrides,
});

describe('computeOccurrenceSummary', () => {
  it('reads the body-only observation as one occurrence', () => {
    const summary = computeOccurrenceSummary(issue());

    expect(summary).toEqual({
      firstSeen: '2026-09-01T00:00:00Z',
      lastSeen: '2026-09-01T00:00:00Z',
      occurrences: 1,
    });
  });

  it('counts the body plus every Additional/Backfilled observation comment, and nothing else', () => {
    const summary = computeOccurrenceSummary(
      issue({
        comments: [
          {
            body: '### Additional observation\n\n- Date: 2026-09-05T00:00:00Z\n',
          },
          {
            body: '### Backfilled observation\n\n- Date: 2026-08-20T00:00:00Z\n',
          },
          { body: '### Repro result\n\n- Date: 2026-09-09T00:00:00Z\n' },
          {
            body: '### Collateral candidate\n\n- Date: 2026-09-10T00:00:00Z\n',
          },
          { body: 'a human note mentioning Date: 2026-09-11T00:00:00Z\n' },
        ],
      }),
    );

    expect(summary).toEqual({
      firstSeen: '2026-08-20T00:00:00Z',
      lastSeen: '2026-09-05T00:00:00Z',
      occurrences: 3,
    });
  });

  // Mirrors dashboard.spec.ts's 'writes an em dash for both date cells when no
  // observation date can be read': occurrences still counts the body as one
  // event even though no date could be read for it — occurrences counts
  // events, not readable dates, so the two are independent computations.
  it('still counts the body as one occurrence when no observation date can be read', () => {
    const summary = computeOccurrenceSummary(
      issue({ body: 'no observation section here' }),
    );

    expect(summary).toEqual({
      firstSeen: null,
      lastSeen: null,
      occurrences: 1,
    });
  });

  it('still counts the body as one occurrence when the body is null and there are no comments', () => {
    const summary = computeOccurrenceSummary(issue({ body: null }));

    expect(summary).toEqual({
      firstSeen: null,
      lastSeen: null,
      occurrences: 1,
    });
  });

  it('counts an unparseable body Date: line as an occurrence but not as a readable date', () => {
    const summary = computeOccurrenceSummary(
      issue({
        body: '### First observation\n\n- Date: not-a-date\n',
        comments: [
          {
            body: '### Additional observation\n\n- Date: 2026-09-05T00:00:00Z\n',
          },
        ],
      }),
    );

    expect(summary).toEqual({
      firstSeen: '2026-09-05T00:00:00Z',
      lastSeen: '2026-09-05T00:00:00Z',
      occurrences: 2,
    });
  });
});
