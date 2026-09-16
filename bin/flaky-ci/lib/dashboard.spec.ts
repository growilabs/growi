import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BODY_CHAR_LIMIT, ZERO_STATE } from './constants.ts';
import {
  type DashboardInput,
  type DashboardIssue,
  render,
} from './dashboard.ts';

const readFixture = (relativePath: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${relativePath}`, import.meta.url)),
    'utf8',
  );

const REAL_INPUT: DashboardInput = JSON.parse(
  readFixture('api/dashboard/render-dashboard-input.json'),
);

/** GitHub stores the body without a trailing newline; `gh api -q` adds one. */
const REAL_BODY = readFixture('api/dashboard/11720-body.md').replace(/\n$/, '');

const issue = (overrides: Partial<DashboardIssue> = {}): DashboardIssue => ({
  number: 1,
  title: 'flaky: vitest:src/a.integ.ts:does a thing',
  labels: ['flaky/confirmed'],
  body: '### First observation\n\n- Date: 2026-09-01T00:00:00Z\n',
  comments: [],
  ...overrides,
});

const input = (overrides: Partial<DashboardInput> = {}): DashboardInput => ({
  updatedAt: '2026-09-16T00:00:00Z',
  issues: [],
  awaitingDecision: [],
  autoClosed: {
    closed: [],
    keptOpenByHumanReopen: [],
    skippedUnreadableDate: [],
  },
  ...overrides,
});

describe('dashboard.render — the three zero states', () => {
  it('replaces the table with the zero-state line when no issue is active, and still renders both sections', () => {
    const body = render(input());

    expect(body).toContain(ZERO_STATE.noActiveFlakyTests);
    expect(body).not.toContain('| Identity | Tier |');
    expect(body).toContain('## Awaiting human decision');
    expect(body).toContain('## Auto-closed this run');
  });

  it('writes the awaiting-decision zero-state line when nothing is paused', () => {
    const body = render(input({ issues: [issue()] }));

    expect(body).toContain(ZERO_STATE.noIssuesAwaitingDecision);
    expect(body).not.toContain('| Tracking issue | Paused at |');
  });

  it('writes `None.` plus both bullet lines when Step 4 closed nothing', () => {
    const body = render(input());

    expect(body).toContain(
      `## Auto-closed this run\n\n${ZERO_STATE.none}\n\n- Kept open by a human reopen: none.\n- Skipped (observation date unreadable): none.`,
    );
  });

  it('keeps both bullet lines, with numbers, when the lists are not empty', () => {
    const body = render(
      input({
        autoClosed: {
          closed: [{ issue: 11700, newestObservation: '2026-09-01T00:00:00Z' }],
          keptOpenByHumanReopen: [11701, 11702],
          skippedUnreadableDate: [11712],
        },
      }),
    );

    expect(body).toContain('| #11700 | 2026-09-01T00:00:00Z |');
    expect(body).toContain('- Kept open by a human reopen: #11701, #11702');
    expect(body).toContain('- Skipped (observation date unreadable): #11712');
    expect(body).not.toContain(`\n${ZERO_STATE.none}\n`);
  });
});

describe('dashboard.render — table rows', () => {
  it('orders rows by tier (confirmed, suspected, observing) then by issue number ascending', () => {
    const body = render(
      input({
        issues: [
          issue({ number: 30, labels: ['flaky/observing'] }),
          issue({ number: 20, labels: ['flaky/confirmed'] }),
          issue({ number: 10, labels: ['flaky/suspected'] }),
          issue({ number: 11, labels: ['flaky/confirmed'] }),
        ],
      }),
    );

    const numbers = [...body.matchAll(/\| #(\d+) \|/g)].map(
      (match) => match[1],
    );
    expect(numbers).toEqual(['11', '20', '10', '30']);
  });

  it('keeps only the strongest tier when an issue carries two tier labels', () => {
    const body = render(
      input({
        issues: [
          issue({ number: 7, labels: ['flaky/observing', 'flaky/confirmed'] }),
        ],
      }),
    );

    const rows = body.split('\n').filter((line) => line.includes('| #7 |'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('| confirmed |');
  });

  it('skips an issue that carries no tier label at all', () => {
    const body = render(
      input({
        issues: [issue({ number: 7, labels: ['flaky/needs-decision'] })],
      }),
    );

    expect(body).toContain(ZERO_STATE.noActiveFlakyTests);
  });

  it('strips the `flaky: ` title prefix for the Identity cell', () => {
    const body = render(input({ issues: [issue()] }));

    expect(body).toContain(
      '| vitest:src/a.integ.ts:does a thing | confirmed |',
    );
  });

  it('counts the body as one occurrence plus every observation comment, and nothing else', () => {
    const body = render(
      input({
        issues: [
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
        ],
      }),
    );

    expect(body).toContain(
      '| 2026-08-20T00:00:00Z | 2026-09-05T00:00:00Z | 3 |',
    );
  });

  it('writes an em dash for both date cells when no observation date can be read', () => {
    const body = render(
      input({ issues: [issue({ body: 'no observation section here' })] }),
    );

    expect(body).toContain('| — | — | 1 |');
  });

  it('takes the last `**Fix PR**: {URL}` line and renders it as a link, ignoring the rest of the comment', () => {
    const body = render(
      input({
        issues: [
          issue({
            comments: [
              {
                body: '**Fix PR**: https://github.com/growilabs/growi/pull/1\n',
              },
              {
                body: 'header\n\n**Fix PR**: https://github.com/growilabs/growi/pull/2  \n\n---\n_Generated by [Claude Code](https://claude.ai/code)_',
              },
            ],
          }),
        ],
      }),
    );

    expect(body).toContain(
      '| [https://github.com/growilabs/growi/pull/2](https://github.com/growilabs/growi/pull/2) |',
    );
  });

  it('writes an em dash in the Fix PR cell when no marker comment exists', () => {
    const body = render(input({ issues: [issue()] }));

    expect(body).toContain('| 1 | #1 | — |');
  });
});

describe('dashboard.render — the awaiting-decision section', () => {
  const paused = (
    number: number,
    pausedAt: string | null,
    extra: Partial<DashboardInput['awaitingDecision'][number]> = {},
  ) => ({
    issue: number,
    pausedAt,
    pausedAtStatus: (pausedAt == null ? 'unavailable' : 'ok') as
      | 'ok'
      | 'unavailable',
    recommendation: 'do the thing',
    recommendationSource: 'in-window' as const,
    newObservations: 0,
    ...extra,
  });

  it('orders rows by Paused at, oldest first, with unreadable ones last', () => {
    const body = render(
      input({
        awaitingDecision: [
          paused(3, '2026-09-02T00:00:00Z'),
          paused(9, null),
          paused(1, '2026-09-01T00:00:00Z'),
        ],
      }),
    );

    const section = body.slice(body.indexOf('## Awaiting human decision'));
    const numbers = [...section.matchAll(/\| #(\d+) \|/g)].map(
      (match) => match[1],
    );
    expect(numbers).toEqual(['1', '3', '9']);
  });

  it('writes an em dash in Paused at and in New observations when the pause time is unavailable', () => {
    const body = render(
      input({
        awaitingDecision: [
          paused(9, null, {
            newObservations: null,
            recommendation: null,
            recommendationSource: 'none',
          }),
        ],
      }),
    );

    expect(body).toContain('| #9 | — | — | — |');
  });

  it('writes the recommendation verbatim — a widened row already carries `(may be stale) `, which must not be added a second time', () => {
    const body = render(
      input({
        awaitingDecision: [
          paused(9, '2026-09-01T00:00:00Z', {
            recommendation: '(may be stale) do the thing',
            recommendationSource: 'widened',
          }),
        ],
      }),
    );

    expect(body.match(/\(may be stale\) /g)).toHaveLength(1);
  });

  it('never prefixes an in-window recommendation', () => {
    const body = render(
      input({ awaitingDecision: [paused(9, '2026-09-01T00:00:00Z')] }),
    );

    expect(body).not.toContain('(may be stale)');
  });
});

describe('dashboard.render — the 65536-character limit', () => {
  const manyIssues = (count: number): readonly DashboardIssue[] =>
    Array.from({ length: count }, (_unused, index) =>
      issue({
        number: index + 1,
        title: `flaky: vitest:src/spec-${index}.integ.ts:${'x'.repeat(200)}`,
        labels: [index < count / 2 ? 'flaky/confirmed' : 'flaky/observing'],
      }),
    );

  it('defaults to 65536 characters', () => {
    const body = render(input({ issues: manyIssues(400) }));

    expect(BODY_CHAR_LIMIT).toBe(65536);
    expect(body.length).toBeLessThanOrEqual(BODY_CHAR_LIMIT);
    expect(body).toContain('truncat');
  });

  it('drops table rows from the bottom of the order, keeps the strongest tiers, and says how many it dropped', () => {
    const body = render(input({ issues: manyIssues(20), limit: 3000 }));

    expect(body.length).toBeLessThanOrEqual(3000);
    const numbers = [...body.matchAll(/\| #(\d+) \|/g)].map((match) =>
      Number(match[1]),
    );
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers.at(-1)).toBeLessThan(20);
    expect(body).toMatch(/\d+ table rows?/);
  });

  it('never drops either section or its zero-state line when the table is truncated', () => {
    const body = render(input({ issues: manyIssues(20), limit: 3000 }));

    expect(body).toContain('## Awaiting human decision');
    expect(body).toContain(ZERO_STATE.noIssuesAwaitingDecision);
    expect(body).toContain('## Auto-closed this run');
    expect(body).toContain(ZERO_STATE.none);
    expect(body).toContain('- Kept open by a human reopen: none.');
    expect(body).toContain('- Skipped (observation date unreadable): none.');
  });

  it('does not write the zero-state line when truncation left no table row', () => {
    // Small enough issue count and tight enough limit that the truncation
    // loop in fitToLimit runs all the way down to zero kept rows, not just
    // "fewer rows" — otherwise this assertion would pass even if the
    // zero-row branch were broken, because a table with 1+ rows already
    // skips the zero-state line.
    const body = render(input({ issues: manyIssues(3), limit: 900 }));

    expect(body).not.toContain(ZERO_STATE.noActiveFlakyTests);
    expect(body).toContain('| Identity | Tier |');
    expect(body).not.toMatch(/\| #\d+ \|/);
    expect(body).toContain('## Awaiting human decision');
    expect(body).toContain('## Auto-closed this run');
    expect(body).toMatch(/table rows? truncated/);
  });

  it('does not write the zero-state line when truncation left no awaiting-decision row', () => {
    // Mirrors the table-side test above: the awaiting-decision list must be
    // truncated all the way to zero rows, not merely shortened, or this
    // assertion would pass even with the zero-row guard removed.
    const awaitingDecision = Array.from({ length: 3 }, (_unused, index) => ({
      issue: index + 1,
      pausedAt: `2026-09-01T0${index}:00:00Z`,
      pausedAtStatus: 'ok' as const,
      recommendation: 'r'.repeat(200),
      recommendationSource: 'in-window' as const,
      newObservations: 0,
    }));

    const body = render(input({ awaitingDecision, limit: 900 }));

    expect(body).toContain('## Awaiting human decision');
    expect(body).not.toContain(ZERO_STATE.noIssuesAwaitingDecision);
    expect(body).toContain('| Tracking issue | Paused at |');
    expect(body).not.toMatch(/\| #\d+ \|.*\|.*\|.*\|/);
    expect(body).toMatch(/Awaiting human decision rows? truncated/);
  });

  it('drops awaiting-decision rows from the bottom, keeping the oldest Paused at, when the two sections alone exceed the limit', () => {
    const awaitingDecision = Array.from({ length: 40 }, (_unused, index) => ({
      issue: index + 1,
      pausedAt: `2026-09-01T${String(index).padStart(2, '0')}:00:00Z`,
      pausedAtStatus: 'ok' as const,
      recommendation: 'r'.repeat(200),
      recommendationSource: 'in-window' as const,
      newObservations: 0,
    }));

    const body = render(input({ awaitingDecision, limit: 3000 }));

    expect(body.length).toBeLessThanOrEqual(3000);
    const section = body.slice(body.indexOf('## Awaiting human decision'));
    const numbers = [...section.matchAll(/\| #(\d+) \|/g)].map((match) =>
      Number(match[1]),
    );
    expect(numbers[0]).toBe(1);
    expect(numbers.at(-1)).toBeLessThan(40);
    expect(body).not.toContain(ZERO_STATE.noIssuesAwaitingDecision);
    expect(body).toContain('## Auto-closed this run');
    expect(body).toContain(ZERO_STATE.none);
    expect(body).toMatch(/Awaiting human decision/);
  });
});

describe('dashboard.render — against the real dashboard body', () => {
  it('reproduces issue #11720 from the issue list and awaiting-decision rows it was built from', () => {
    expect(render(REAL_INPUT)).toBe(REAL_BODY);
  });
});
