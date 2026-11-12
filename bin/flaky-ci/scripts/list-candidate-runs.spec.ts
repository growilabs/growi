import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { GhApi, GhParams } from '../lib/gh.ts';
import { GhError } from '../lib/gh.ts';
import { parseArgv, run } from './list-candidate-runs.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./list-candidate-runs.ts', import.meta.url),
);

const readFixtureJson = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const PAGE_1 = readFixtureJson(
  '../fixtures/api/list-candidate-runs-ci-app-page1.json',
);
const PAGE_2 = readFixtureJson(
  '../fixtures/api/list-candidate-runs-ci-app-page2.json',
);
const PAGE_3 = readFixtureJson(
  '../fixtures/api/list-candidate-runs-ci-app-page3.json',
);

/**
 * A `GhApi` whose `get` returns one page per call, keyed by `params.page`,
 * and records every path/params it was called with — so a test can assert a
 * later page was never fetched (the whole point of stopping early).
 */
const fakeGhApi = (
  pagesByNumber: Readonly<Record<number, unknown>>,
): { readonly api: GhApi; readonly calls: GhParams[] } => {
  const calls: GhParams[] = [];
  return {
    calls,
    api: {
      get: <T>(_path: string, params: GhParams = {}) => {
        calls.push(params);
        const page = Number(params.page);
        const body = pagesByNumber[page];
        if (body == null) {
          return Promise.reject(new Error(`test fixture has no page ${page}`));
        }
        return Promise.resolve(body as T);
      },
      getAll: () => {
        throw new Error('unexpected call to GhApi.getAll in this test');
      },
    },
  };
};

const failingGhApi = (error: unknown): GhApi => ({
  get: () => Promise.reject(error),
  getAll: () => Promise.reject(error),
});

describe('list-candidate-runs.run', () => {
  it('combines pages and drops runs older than --window-hours, without fetching a page past the crossing one', async () => {
    const { api, calls } = fakeGhApi({ 1: PAGE_1, 2: PAGE_2, 3: PAGE_3 });

    const result = await run(api, () => '2026-09-16T10:00:00Z', {
      workflow: 'ci-app.yml',
      windowHours: 4,
      maxRuns: 300,
    });

    // cutoff = 2026-09-16T06:00:00Z. Page 1 (5 runs, all >= cutoff) and page 2
    // (5 runs, only the first 2 >= cutoff) are fetched; page 2's oldest run
    // (05:49:54Z) falls before the cutoff, so the loop must stop there and
    // never ask for page 3.
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.page)).toEqual([1, 2]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.truncated).toBe(false);
    const runs = result.facts.runs as readonly { readonly id: number }[];
    expect(runs).toHaveLength(7);
    expect(runs.map((r) => r.id)).toEqual([
      35081698971, 35078736242, 35078535322, 35070936491, 35070931630,
      35062156266, 35062153029,
    ]);
    // Field shape/renaming: id (not databaseId — see fixtures meta.md),
    // headSha, createdAt, url, event, attempt.
    expect(runs[0]).toEqual({
      id: 35081698971,
      conclusion: 'success',
      headSha: '0d1a319a106b2a791e883170782e856f88b0e178',
      createdAt: '2026-09-16T09:50:44Z',
      url: 'https://github.com/growilabs/growi/actions/runs/35081698971',
      event: 'pull_request',
      attempt: 1,
    });
  });

  it('stops paging and reports truncated:true once --max-runs is reached, before the window is exhausted', async () => {
    const { api, calls } = fakeGhApi({ 1: PAGE_1, 2: PAGE_2, 3: PAGE_3 });

    const result = await run(api, () => '2026-09-16T10:00:00Z', {
      workflow: 'ci-app.yml',
      windowHours: 1000,
      maxRuns: 5,
    });

    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, facts: { truncated: true } });
    if (result.ok) {
      expect(result.facts.runs).toHaveLength(5);
    }
  });

  it('returns an empty, non-failing result when the workflow has no completed runs at all', async () => {
    const { api } = fakeGhApi({ 1: { workflow_runs: [] } });

    const result = await run(api, () => '2026-09-16T10:00:00Z', {
      workflow: 'ci-app.yml',
      windowHours: 32,
      maxRuns: 300,
    });

    expect(result).toEqual({
      ok: true,
      facts: { runs: [], truncated: false },
    });
  });

  it('fails with exit-2 semantics when the API cannot be read at all (nothing collected)', async () => {
    const error = new GhError(
      'exit-nonzero',
      'gh api failed: Not Found (HTTP 404)',
    );

    const result = await run(
      failingGhApi(error),
      () => '2026-09-16T10:00:00Z',
      {
        workflow: 'no-such-workflow.yml',
        windowHours: 32,
        maxRuns: 300,
      },
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        reason: expect.stringContaining(error.message),
      },
    });
  });

  it('reports truncated:true (not exit 2) when a later page fails after earlier pages already produced runs', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: rate limited');
    const { api } = fakeGhApi({ 1: PAGE_1 });
    const failingOnPage2: GhApi = {
      get: (path, params) => {
        if (Number(params?.page) >= 2) {
          return Promise.reject(error);
        }
        return api.get(path, params);
      },
      getAll: () => {
        throw new Error('unexpected call to GhApi.getAll in this test');
      },
    };

    const result = await run(failingOnPage2, () => '2026-09-16T10:00:00Z', {
      workflow: 'ci-app.yml',
      windowHours: 1000,
      maxRuns: 300,
    });

    expect(result).toMatchObject({ ok: true, facts: { truncated: true } });
    if (result.ok) {
      expect(result.facts.runs).toHaveLength(5);
    }
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');

    await expect(
      run(failingGhApi(bug), () => '2026-09-16T10:00:00Z', {
        workflow: 'ci-app.yml',
        windowHours: 32,
        maxRuns: 300,
      }),
    ).rejects.toBe(bug);
  });
});

describe('list-candidate-runs.parseArgv', () => {
  it('requires --workflow, --window-hours and --max-runs', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason:
        '--workflow, --window-hours and --max-runs are all required, and --window-hours/--max-runs must be positive integers',
    });
    expect(parseArgv(['--workflow', 'ci-app.yml'])).toEqual({
      kind: 'invalid',
      reason:
        '--workflow, --window-hours and --max-runs are all required, and --window-hours/--max-runs must be positive integers',
    });
  });

  it('rejects a non-positive-integer --window-hours or --max-runs', () => {
    expect(
      parseArgv([
        '--workflow',
        'ci-app.yml',
        '--window-hours',
        '0',
        '--max-runs',
        '300',
      ]),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      parseArgv([
        '--workflow',
        'ci-app.yml',
        '--window-hours',
        '32',
        '--max-runs',
        'many',
      ]),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      parseArgv([
        '--workflow',
        'ci-app.yml',
        '--window-hours',
        '-1',
        '--max-runs',
        '300',
      ]),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('parses named flags in any order', () => {
    expect(
      parseArgv([
        '--max-runs',
        '300',
        '--workflow',
        'ci-app-prod.yml',
        '--window-hours',
        '32',
      ]),
    ).toEqual({
      kind: 'args',
      value: { workflow: 'ci-app-prod.yml', windowHours: 32, maxRuns: 300 },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--workflow', 'x', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('list-candidate-runs CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--workflow');
    expect(stdout).toContain('--window-hours');
    expect(stdout).toContain('--max-runs');
  });

  it('exits 2 with empty stdout when required flags are missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '--workflow, --window-hours and --max-runs',
    );
  });
});
