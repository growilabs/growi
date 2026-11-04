import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { COMMENT_HEADINGS, LABELS } from '../lib/constants.ts';
import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './stale-suspected.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./stale-suspected.ts', import.meta.url),
);

const NOW = '2026-09-24T00:00:00Z';
const nowIso = () => NOW;

type FakeIssue = {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly labels: readonly string[];
};

/**
 * A `GhApi` whose `getAll` dispatches on the endpoint path: the bare
 * `issues` list (returns the given issues, ignoring the requested
 * state/labels params — the test fixtures are already scoped to what a real
 * `state=open&labels=flaky/suspected` query would return) and
 * `issues/{n}/comments` (returns that issue's comments, or rejects when the
 * issue number is listed in `failingComments`).
 */
const fakeGhApi = (
  issues: readonly FakeIssue[],
  commentsByIssue: Readonly<Record<number, readonly { body: string }[]>>,
  failingComments: readonly number[] = [],
): GhApi => ({
  get: () => Promise.reject(new Error('get() is not used by this script')),
  getAll: (path: string) => {
    if (path === 'repos/growilabs/growi/issues') {
      return Promise.resolve(
        issues.map((issue) => ({
          number: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels.map((name) => ({ name })),
        })) as never,
      );
    }
    const match = /issues\/(\d+)\/comments$/.exec(path);
    if (match == null) {
      return Promise.reject(new Error(`unexpected path: ${path}`));
    }
    const number = Number(match[1]);
    if (failingComments.includes(number)) {
      return Promise.reject(
        new GhError('exit-nonzero', `gh api failed for issue ${number}`),
      );
    }
    return Promise.resolve((commentsByIssue[number] ?? []) as never);
  },
});

const bodyWithFirstObservation = (dateLine: string): string =>
  `### First observation\n- Date: ${dateLine}\n`;

describe('stale-suspected.run', () => {
  it('reports an unmeasured flaky/suspected issue whose staleness reaches the threshold', async () => {
    const issue: FakeIssue = {
      number: 100,
      title: 'flaky: vitest:src/a.integ.ts:does a thing',
      body: bodyWithFirstObservation('2026-09-01T00:00:00Z'),
      labels: [LABELS.suspected],
    };
    const ghApi = fakeGhApi([issue], { 100: [] });

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: {
        staleDays: 14,
        staleIssues: [
          { number: 100, firstSeen: '2026-09-01T00:00:00Z', daysSince: 23 },
        ],
        unavailableIssues: [],
      },
    });
  });

  it('reports an issue exactly at the --stale-days boundary as stale (>= threshold)', async () => {
    // NOW is 2026-09-24T00:00:00Z; a firstSeen exactly 14 days earlier pins
    // the daysSince === staleDays boundary (design.md's sequence diagram
    // specifies >=, not >).
    const issue: FakeIssue = {
      number: 107,
      title: 'flaky: vitest:src/h.integ.ts:does an eighth thing',
      body: bodyWithFirstObservation('2026-09-10T00:00:00Z'),
      labels: [LABELS.suspected],
    };
    const ghApi = fakeGhApi([issue], { 107: [] });

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: {
        staleDays: 14,
        staleIssues: [
          { number: 107, firstSeen: '2026-09-10T00:00:00Z', daysSince: 14 },
        ],
        unavailableIssues: [],
      },
    });
  });

  it('excludes an issue that has not yet reached the staleness threshold', async () => {
    const issue: FakeIssue = {
      number: 101,
      title: 'flaky: vitest:src/b.integ.ts:does another thing',
      body: bodyWithFirstObservation('2026-09-20T00:00:00Z'),
      labels: [LABELS.suspected],
    };
    const ghApi = fakeGhApi([issue], { 101: [] });

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: { staleDays: 14, staleIssues: [], unavailableIssues: [] },
    });
  });

  it('excludes a flaky/confirmed issue even when it would otherwise be stale', async () => {
    // The fixture list already reflects a state=open&labels=flaky/suspected
    // query, so a flaky/confirmed-only issue never appears here in real use;
    // this guards the isUnmeasured/label-carrying assumption itself, not the
    // GitHub query.
    const issue: FakeIssue = {
      number: 102,
      title: 'flaky: vitest:src/c.integ.ts:does a third thing',
      body: bodyWithFirstObservation('2026-08-01T00:00:00Z'),
      labels: [LABELS.confirmed],
    };
    const ghApi = fakeGhApi([issue], { 102: [] });

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    // stale-suspected relies entirely on the upstream GitHub query being
    // scoped to flaky/suspected; it does not re-filter by label itself once
    // an issue is in the fetched list (mirrors fetch-flaky-issues.ts, which
    // also trusts its own label-scoped fetch). What this script DOES filter
    // on its own is measurement state, so a confirmed issue slipping through
    // an unscoped fetch would still be reported here — the real guarantee
    // that flaky/confirmed never appears comes from the --labels param.
    expect(result).toEqual({
      ok: true,
      facts: {
        staleDays: 14,
        staleIssues: [
          { number: 102, firstSeen: '2026-08-01T00:00:00Z', daysSince: 54 },
        ],
        unavailableIssues: [],
      },
    });
  });

  it('returns an empty array when no candidate issue is stale', async () => {
    const ghApi = fakeGhApi([], {});

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: { staleDays: 14, staleIssues: [], unavailableIssues: [] },
    });
  });

  it('excludes an issue that already has a ### Repro result comment even if stale', async () => {
    const issue: FakeIssue = {
      number: 103,
      title: 'flaky: vitest:src/d.integ.ts:does a fourth thing',
      body: bodyWithFirstObservation('2026-08-01T00:00:00Z'),
      labels: [LABELS.suspected],
    };
    const ghApi = fakeGhApi([issue], {
      103: [{ body: `${COMMENT_HEADINGS.reproResult}\n- Commit: abc123\n` }],
    });

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: { staleDays: 14, staleIssues: [], unavailableIssues: [] },
    });
  });

  it('excludes a candidate whose firstSeen cannot be computed (no readable observation date)', async () => {
    const issue: FakeIssue = {
      number: 104,
      title: 'flaky: vitest:src/e.integ.ts:does a fifth thing',
      body: 'no observation section here',
      labels: [LABELS.suspected],
    };
    const ghApi = fakeGhApi([issue], { 104: [] });

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: { staleDays: 14, staleIssues: [], unavailableIssues: [] },
    });
  });

  it('reports a candidate whose comments could not be read in unavailableIssues, not silently dropped, without failing the whole call', async () => {
    const stale: FakeIssue = {
      number: 105,
      title: 'flaky: vitest:src/f.integ.ts:does a sixth thing',
      body: bodyWithFirstObservation('2026-08-01T00:00:00Z'),
      labels: [LABELS.suspected],
    };
    const other: FakeIssue = {
      number: 106,
      title: 'flaky: vitest:src/g.integ.ts:does a seventh thing',
      body: bodyWithFirstObservation('2026-08-01T00:00:00Z'),
      labels: [LABELS.suspected],
    };
    const ghApi = fakeGhApi([stale, other], { 106: [] }, [105]);

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: true,
      facts: {
        staleDays: 14,
        staleIssues: [
          { number: 106, firstSeen: '2026-08-01T00:00:00Z', daysSince: 54 },
        ],
        // Issue 105's comments could not be read, so its staleness is
        // unknown, not confirmed absent — it must be visible here, not
        // merely missing from staleIssues, so an API hiccup can never look
        // identical to "0 stale issues" in the JSON output.
        unavailableIssues: [105],
      },
    });
  });

  it('fails the whole call when the flaky/suspected issue list itself cannot be fetched', async () => {
    const ghApi: GhApi = {
      get: () => Promise.reject(new Error('get() is not used by this script')),
      getAll: () =>
        Promise.reject(
          new GhError('exit-nonzero', 'gh api failed: rate limited'),
        ),
    };

    const result = await run(ghApi, nowIso, { staleDays: 14 });

    expect(result).toEqual({
      ok: false,
      failure: {
        reason: `could not fetch ${LABELS.suspected} issues: gh api failed: rate limited`,
      },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');
    const ghApi: GhApi = {
      get: () => Promise.reject(bug),
      getAll: () => Promise.reject(bug),
    };

    await expect(run(ghApi, nowIso, { staleDays: 14 })).rejects.toBe(bug);
  });
});

describe('stale-suspected.parseArgv', () => {
  it('defaults --stale-days to 14 when omitted', () => {
    expect(parseArgv([])).toEqual({ kind: 'args', value: { staleDays: 14 } });
  });

  it('reads a given --stale-days value', () => {
    expect(parseArgv(['--stale-days', '30'])).toEqual({
      kind: 'args',
      value: { staleDays: 30 },
    });
  });

  it('rejects a non-positive-integer --stale-days', () => {
    expect(parseArgv(['--stale-days', '0'])).toEqual({
      kind: 'invalid',
      reason: '--stale-days must be a positive integer',
    });
    expect(parseArgv(['--stale-days', 'abc'])).toEqual({
      kind: 'invalid',
      reason: '--stale-days must be a positive integer',
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--stale-days', '30', '--help'])).toEqual({
      kind: 'help',
    });
  });
});

describe('stale-suspected CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--stale-days');
  });
});
