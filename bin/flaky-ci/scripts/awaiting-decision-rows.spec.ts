import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './awaiting-decision-rows.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./awaiting-decision-rows.ts', import.meta.url),
);

const readFixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

/** A `GhApi` whose `getAll` dispatches on the endpoint path suffix. */
const fakeGhApi = (
  eventsByIssue: Readonly<Record<string, unknown[]>>,
  commentsByIssue: Readonly<Record<string, unknown[]>>,
): GhApi => ({
  get: () => Promise.reject(new Error('get() is not used by this script')),
  getAll: (path: string) => {
    const match = /issues\/([^/]+)\/(events|comments)$/.exec(path);
    if (match == null) {
      return Promise.reject(new Error(`unexpected path: ${path}`));
    }
    const [, issue, kind] = match;
    const table = kind === 'events' ? eventsByIssue : commentsByIssue;
    return Promise.resolve((table[issue] ?? []) as never);
  },
});

describe('awaiting-decision-rows.run', () => {
  it('reports the label added BEFORE the recommendation comment (normal ordering, issue #11823)', async () => {
    const events = readFixture(
      '../fixtures/api/issues/11823-events.json',
    ) as unknown[];
    const comments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as unknown[];
    const ghApi = fakeGhApi({ '11823': events }, { '11823': comments });

    const result = await run(ghApi, { issues: ['11823'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '11823',
            pausedAt: '2026-09-14T15:57:36Z',
            pausedAtStatus: 'ok',
            recommendation:
              'Take the confirmation measurement (Step 2) on master first; equal expireAt across three keep-alive intervals means no reminder request landed in that window, so widen the read spacing relative to KEEP_ALIVE_INTERVAL_MS rather than relax toBeGreaterThan.',
            recommendationSource: 'in-window',
            newObservations: 0,
          },
        ],
      },
    });
  });

  it('reports the label added AFTER the recommendation comment without treating reversed order as out-of-window (issue #11914)', async () => {
    const events = readFixture(
      '../fixtures/api/issues/11914-events.json',
    ) as unknown[];
    const comments = readFixture(
      '../fixtures/api/issues/11914-comments.json',
    ) as unknown[];
    const ghApi = fakeGhApi({ '11914': events }, { '11914': comments });

    const result = await run(ghApi, { issues: ['11914'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '11914',
            pausedAt: '2026-09-14T19:45:45Z',
            pausedAtStatus: 'ok',
            recommendation:
              'proceed with the fix above (wait for the `growi-inline-comment` highlight to be registered before clicking or hovering it, in the four body-popover tests).',
            recommendationSource: 'in-window',
            newObservations: 0,
          },
        ],
      },
    });
  });

  it('marks the row unavailable and widens the recommendation search when no labeled event can be read (synthetic)', async () => {
    const events = readFixture(
      '../fixtures/api/issues/synthetic-no-labeled-event-11823-events.json',
    ) as unknown[];
    const comments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as unknown[];
    const ghApi = fakeGhApi({ '11823': events }, { '11823': comments });

    const result = await run(ghApi, { issues: ['11823'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '11823',
            pausedAt: null,
            pausedAtStatus: 'unavailable',
            recommendation:
              '(may be stale) Take the confirmation measurement (Step 2) on master first; equal expireAt across three keep-alive intervals means no reminder request landed in that window, so widen the read spacing relative to KEEP_ALIVE_INTERVAL_MS rather than relax toBeGreaterThan.',
            recommendationSource: 'widened',
            newObservations: null,
          },
        ],
      },
    });
  });

  it('never re-selects when new observation comments arrive later — count reflects the exact same fixture regardless of extra unrelated comments', async () => {
    // Regression guard for the procedure's stability rule ("never re-pick when
    // new observation comments arrive later"): this script is a pure read of
    // its input, so appending a later, non-qualifying comment must not change
    // an already-computed recommendation, only the observation count.
    const events = readFixture(
      '../fixtures/api/issues/11823-events.json',
    ) as unknown[];
    const comments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as unknown[];
    const extraObservation = {
      id: 999,
      created_at: '2026-09-15T00:00:00Z',
      body: '### Additional observation\n\n- Date: 2026-09-15T00:00:00Z\n',
      user: { type: 'Bot' },
    };
    const ghApi = fakeGhApi(
      { '11823': events },
      { '11823': [...comments, extraObservation] },
    );

    const result = await run(ghApi, { issues: ['11823'] });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        rows: [
          expect.objectContaining({
            recommendationSource: 'in-window',
            newObservations: 1,
          }),
        ],
      },
    });
  });

  it('handles exactly one qualifying comment in the window (single-candidate reduce, no seed) without a fabricated success or short-circuit bug', async () => {
    const events = [
      {
        event: 'labeled',
        created_at: '2026-01-01T00:00:00Z',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const comments = [
      {
        id: 1,
        created_at: '2026-01-01T00:00:05Z',
        body: 'Investigated by Claude Code\n- Recommendation: only one candidate here.',
        user: { type: 'User' },
      },
    ];
    const ghApi = fakeGhApi({ '1': events }, { '1': comments });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: '2026-01-01T00:00:00Z',
            pausedAtStatus: 'ok',
            recommendation: 'only one candidate here.',
            recommendationSource: 'in-window',
            newObservations: 0,
          },
        ],
      },
    });
  });

  it('handles exactly one labeled event (single-candidate reduce, no seed) for pausedAt', async () => {
    const events = [
      {
        event: 'labeled',
        created_at: '2026-01-01T00:00:00Z',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const ghApi = fakeGhApi({ '1': events }, { '1': [] });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: '2026-01-01T00:00:00Z',
            pausedAtStatus: 'ok',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: 0,
          },
        ],
      },
    });
  });

  it('handles zero labeled events and zero qualifying comments', async () => {
    const ghApi = fakeGhApi({ '1': [] }, { '1': [] });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: null,
            pausedAtStatus: 'unavailable',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: null,
          },
        ],
      },
    });
  });

  it('builds one row per --issue, in the given order, and tolerates a GhError on one issue without failing the whole result', async () => {
    const events11823 = readFixture(
      '../fixtures/api/issues/11823-events.json',
    ) as unknown[];
    const comments11823 = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as unknown[];
    const ghApi: GhApi = {
      get: () => Promise.reject(new Error('unused')),
      getAll: (path: string) => {
        if (path.includes('/99999/')) {
          return Promise.reject(
            new GhError('exit-nonzero', 'gh api failed: Not Found (HTTP 404)'),
          );
        }
        if (path.endsWith('/events')) {
          return Promise.resolve(events11823 as never);
        }
        return Promise.resolve(comments11823 as never);
      },
    };

    const result = await run(ghApi, { issues: ['11823', '99999'] });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        rows: [
          expect.objectContaining({ issue: '11823', pausedAtStatus: 'ok' }),
          {
            issue: '99999',
            pausedAt: null,
            pausedAtStatus: 'unavailable',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: null,
          },
        ],
      },
    });
  });

  it('marks the row unavailable, without throwing, when the only labeled event has a malformed created_at (single-candidate reduce skips comparator validation)', async () => {
    const events = [
      {
        event: 'labeled',
        created_at: 'not-a-real-date',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const ghApi = fakeGhApi({ '1': events }, { '1': [] });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: null,
            pausedAtStatus: 'unavailable',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: null,
          },
        ],
      },
    });
  });

  it('skips a malformed labeled event and still finds the newest well-formed one, rather than discarding the whole row (mixed events)', async () => {
    const events = [
      {
        event: 'labeled',
        created_at: 'not-a-real-date',
        label: { name: 'flaky/needs-decision' },
      },
      {
        event: 'labeled',
        created_at: '2026-01-01T00:00:00Z',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const ghApi = fakeGhApi({ '1': events }, { '1': [] });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: '2026-01-01T00:00:00Z',
            pausedAtStatus: 'ok',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: 0,
          },
        ],
      },
    });
  });

  it('isolates a malformed-label-event row from a healthy row in the same multi-issue call (batch is not aborted)', async () => {
    const healthyEvents = readFixture(
      '../fixtures/api/issues/11823-events.json',
    ) as unknown[];
    const healthyComments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as unknown[];
    const malformedEvents = [
      {
        event: 'labeled',
        created_at: 'not-a-real-date',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const ghApi = fakeGhApi(
      { '11823': healthyEvents, bad: malformedEvents },
      { '11823': healthyComments, bad: [] },
    );

    const result = await run(ghApi, { issues: ['bad', '11823'] });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        rows: [
          {
            issue: 'bad',
            pausedAt: null,
            pausedAtStatus: 'unavailable',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: null,
          },
          expect.objectContaining({ issue: '11823', pausedAtStatus: 'ok' }),
        ],
      },
    });
  });

  it('skips a single qualifying comment with a malformed created_at instead of throwing (in-window filter site)', async () => {
    const events = [
      {
        event: 'labeled',
        created_at: '2026-01-01T00:00:00Z',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const comments = [
      {
        id: 1,
        created_at: 'not-a-real-date',
        body: 'Investigated by Claude Code\n- Recommendation: this must not crash the run.',
        user: { type: 'User' },
      },
    ];
    const ghApi = fakeGhApi({ '1': events }, { '1': comments });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: '2026-01-01T00:00:00Z',
            pausedAtStatus: 'ok',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: 0,
          },
        ],
      },
    });
  });

  it('skips a malformed-created_at comment and still picks the valid one under the widened (no labeled event) branch', async () => {
    const comments = [
      {
        id: 1,
        created_at: 'not-a-real-date',
        body: 'Investigated by Claude Code\n- Recommendation: malformed, must be skipped.',
        user: { type: 'User' },
      },
      {
        id: 2,
        created_at: '2026-01-01T00:00:05Z',
        body: 'Investigated by Claude Code\n- Recommendation: the valid one wins.',
        user: { type: 'User' },
      },
    ];
    const ghApi = fakeGhApi({ '1': [] }, { '1': comments });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: null,
            pausedAtStatus: 'unavailable',
            recommendation: '(may be stale) the valid one wins.',
            recommendationSource: 'widened',
            newObservations: null,
          },
        ],
      },
    });
  });

  it('isolates a malformed-comment row from a healthy row in the same multi-issue call (batch is not aborted)', async () => {
    const healthyEvents = readFixture(
      '../fixtures/api/issues/11823-events.json',
    ) as unknown[];
    const healthyComments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as unknown[];
    const malformedCommentEvents = [
      {
        event: 'labeled',
        created_at: '2026-01-01T00:00:00Z',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const malformedComments = [
      {
        id: 1,
        created_at: 'not-a-real-date',
        body: 'Investigated by Claude Code\n- Recommendation: malformed row must not take down the batch.',
        user: { type: 'User' },
      },
    ];
    const ghApi = fakeGhApi(
      { '11823': healthyEvents, bad: malformedCommentEvents },
      { '11823': healthyComments, bad: malformedComments },
    );

    const result = await run(ghApi, { issues: ['bad', '11823'] });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        rows: [
          {
            issue: 'bad',
            pausedAt: '2026-01-01T00:00:00Z',
            pausedAtStatus: 'ok',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: 0,
          },
          expect.objectContaining({ issue: '11823', pausedAtStatus: 'ok' }),
        ],
      },
    });
  });

  it('excludes an observation comment with a malformed date from the new-observations count instead of throwing', async () => {
    const events = [
      {
        event: 'labeled',
        created_at: '2026-01-01T00:00:00Z',
        label: { name: 'flaky/needs-decision' },
      },
    ];
    const comments = [
      {
        id: 1,
        created_at: 'not-a-real-date',
        body: '### Additional observation\n\n- Date: not-a-real-date\n',
        user: { type: 'Bot' },
      },
      {
        id: 2,
        created_at: '2026-01-02T00:00:00Z',
        body: '### Additional observation\n\n- Date: 2026-01-02T00:00:00Z\n',
        user: { type: 'Bot' },
      },
    ];
    const ghApi = fakeGhApi({ '1': events }, { '1': comments });

    const result = await run(ghApi, { issues: ['1'] });

    expect(result).toEqual({
      ok: true,
      facts: {
        rows: [
          {
            issue: '1',
            pausedAt: '2026-01-01T00:00:00Z',
            pausedAtStatus: 'ok',
            recommendation: null,
            recommendationSource: 'none',
            newObservations: 1,
          },
        ],
      },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');
    const ghApi: GhApi = {
      get: () => Promise.reject(bug),
      getAll: () => Promise.reject(bug),
    };

    await expect(run(ghApi, { issues: ['1'] })).rejects.toBe(bug);
  });
});

describe('awaiting-decision-rows.parseArgv', () => {
  it('requires at least one --issue', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: 'at least one --issue is required',
    });
  });

  it('collects every --issue occurrence, in order', () => {
    expect(parseArgv(['--issue', '11823', '--issue', '11914'])).toEqual({
      kind: 'args',
      value: { issues: ['11823', '11914'] },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--issue', '1', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('awaiting-decision-rows CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--issue');
  });

  it('exits 2 with empty stdout when no --issue is given', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('at least one --issue is required');
  });
});
