import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { RawCheckRun } from '../lib/check-runs.ts';
import { type GhApi, GhError } from '../lib/gh.ts';
import { type GitDiff, parseArgv, run } from './pr-gate-facts.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./pr-gate-facts.ts', import.meta.url),
);

const readFixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const ISSUE_11823_COMMENTS = readFixture(
  '../fixtures/api/issues/11823-comments.json',
) as readonly unknown[];
const ISSUE_11821_COMMENTS = readFixture(
  '../fixtures/api/issues/11821-comments.json',
) as readonly unknown[];
const CI_APP_FAILURES = (
  readFixture('../fixtures/api/check-runs/235dd237-check-runs.json') as {
    check_runs: RawCheckRun[];
  }
).check_runs;
const UNIQUE_NAMES = (
  readFixture('../fixtures/api/check-runs/0d1a319a-check-runs.json') as {
    check_runs: RawCheckRun[];
  }
).check_runs;

const CASE1_ISSUE = '11823';
const CASE1_SHA = 'b9a64ded27e0ce4cc30a0563d5be5133db0f027a';
const NO_MATCH_SHA = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

type Routes = {
  readonly comments?: readonly unknown[];
  readonly commentsError?: unknown;
  readonly checkRuns?: readonly unknown[];
  readonly checkRunsError?: unknown;
};

/** A `GhApi` that dispatches by path shape, matching the endpoints this script calls. */
const routedGhApi = (routes: Routes): GhApi => ({
  get: <T>(path: string, params?: Record<string, string | number>) => {
    if (path.endsWith('/check-runs')) {
      if (routes.checkRunsError != null) {
        return Promise.reject(routes.checkRunsError);
      }
      if (params?.page !== 1) {
        return Promise.resolve({ check_runs: [] } as T);
      }
      return Promise.resolve({ check_runs: routes.checkRuns ?? [] } as T);
    }
    throw new Error(`unexpected GhApi.get call: ${path}`);
  },
  getAll: <T>(path: string) => {
    if (path.endsWith('/comments')) {
      if (routes.commentsError != null) {
        return Promise.reject(routes.commentsError);
      }
      return Promise.resolve((routes.comments ?? []) as readonly T[]);
    }
    throw new Error(`unexpected GhApi.getAll call: ${path}`);
  },
});

const fakeGitDiff =
  (files: readonly string[]): GitDiff =>
  async () =>
    files;
const failingGitDiff =
  (error: unknown): GitDiff =>
  () =>
    Promise.reject(error);

describe('pr-gate-facts.run', () => {
  it('returns the tally, ciApp and changedFiles for a fix commit with a matching repro comment', async () => {
    const ghApi = routedGhApi({
      comments: ISSUE_11823_COMMENTS,
      checkRuns: UNIQUE_NAMES,
    });

    const result = await run(ghApi, fakeGitDiff(['apps/app/src/foo.spec.ts']), {
      issue: CASE1_ISSUE,
      sha: CASE1_SHA,
      base: 'origin/master',
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        tally: {
          runs: 3,
          failed: 0,
          perRun: ['pass', 'pass', 'pass'],
          workflowRunUrl:
            'https://github.com/growilabs/growi/actions/runs/34867613127',
          commentUrl:
            'https://github.com/growilabs/growi/issues/11823#issuecomment-5667125454',
        },
        ciApp: { total: 7, notSuccess: [] },
        changedFiles: ['apps/app/src/foo.spec.ts'],
      },
    });
  });

  it('reports tally: null (not a failure) when no comment on the issue carries the commit', async () => {
    const ghApi = routedGhApi({
      comments: ISSUE_11821_COMMENTS,
      checkRuns: UNIQUE_NAMES,
    });

    const result = await run(ghApi, fakeGitDiff([]), {
      issue: '11821',
      sha: NO_MATCH_SHA,
      base: 'origin/master',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.tally).toBeNull();
  });

  it('reports ciApp.total 0 (not a failure) when no ci-app-* check-run exists — the "condition 2 not satisfied" case', async () => {
    const ghApi = routedGhApi({
      comments: ISSUE_11821_COMMENTS,
      checkRuns: [],
    });

    const result = await run(ghApi, fakeGitDiff([]), {
      issue: '11821',
      sha: NO_MATCH_SHA,
      base: 'origin/master',
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        tally: null,
        ciApp: { total: 0, notSuccess: [] },
        changedFiles: [],
      },
    });
  });

  it('reports ciApp.notSuccess for the newest-per-name failures, deduped (real: commit 235dd237)', async () => {
    const ghApi = routedGhApi({
      comments: [],
      checkRuns: CI_APP_FAILURES,
    });

    const result = await run(ghApi, fakeGitDiff([]), {
      issue: '1',
      sha: '235dd23767763951a25bbdb796e35be3d5c6c354',
      base: 'origin/master',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ciApp = result.facts.ciApp as {
      total: number;
      notSuccess: readonly { name: string }[];
    };
    expect(ciApp.total).toBe(7);
    expect(ciApp.notSuccess.map((check) => check.name).sort()).toEqual([
      'ci-app-test (24.x, 6.0)',
      'ci-app-test (24.x, 8.0)',
      'ci-app-test-integration (24.x, 8.0, 8, 8.19.16)',
    ]);
  });

  it('fails when the issue comments call fails outright', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: Not Found');
    const ghApi = routedGhApi({ commentsError: error });

    const result = await run(ghApi, fakeGitDiff([]), {
      issue: '999999',
      sha: NO_MATCH_SHA,
      base: 'origin/master',
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: expect.stringContaining('999999') },
    });
  });

  it('fails when the check-runs call fails outright', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: Not Found');
    const ghApi = routedGhApi({
      comments: ISSUE_11821_COMMENTS,
      checkRunsError: error,
    });

    const result = await run(ghApi, fakeGitDiff([]), {
      issue: '11821',
      sha: NO_MATCH_SHA,
      base: 'origin/master',
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: expect.stringContaining(NO_MATCH_SHA) },
    });
  });

  it('fails when the local git diff fails outright', async () => {
    const ghApi = routedGhApi({
      comments: ISSUE_11821_COMMENTS,
      checkRuns: UNIQUE_NAMES,
    });

    const result = await run(
      ghApi,
      failingGitDiff(new Error('git: fatal: bad revision')),
      { issue: '11821', sha: NO_MATCH_SHA, base: 'origin/master' },
    );

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: expect.stringContaining('bad revision') },
    });
  });

  it('lets an unexpected (non-GhError) comments error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');
    const ghApi = routedGhApi({ commentsError: bug });

    await expect(
      run(ghApi, fakeGitDiff([]), {
        issue: '1',
        sha: 'x',
        base: 'origin/master',
      }),
    ).rejects.toBe(bug);
  });
});

describe('pr-gate-facts.parseArgv', () => {
  it('requires both --issue and --sha', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--issue and --sha are both required',
    });
    expect(parseArgv(['--issue', '11823'])).toEqual({
      kind: 'invalid',
      reason: '--issue and --sha are both required',
    });
  });

  it('defaults --base to origin/master when not given', () => {
    expect(parseArgv(['--issue', '1', '--sha', 'abc'])).toEqual({
      kind: 'args',
      value: { issue: '1', sha: 'abc', base: 'origin/master' },
    });
  });

  it('accepts an explicit --base', () => {
    expect(
      parseArgv(['--issue', '1', '--sha', 'abc', '--base', 'origin/dev/8.0.x']),
    ).toEqual({
      kind: 'args',
      value: { issue: '1', sha: 'abc', base: 'origin/dev/8.0.x' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--issue', '1', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('pr-gate-facts CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--issue');
    expect(stdout).toContain('--sha');
  });

  it('exits 2 with empty stdout when required flags are missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--issue and --sha are both required');
  });
});
