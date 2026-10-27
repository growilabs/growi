import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import type { RawCheckRun } from '../lib/check-runs.ts';
import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './check-runs-facts.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./check-runs-facts.ts', import.meta.url),
);

const readFixture = (relativePath: string): { check_runs: RawCheckRun[] } =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const UNIQUE_NAMES = readFixture(
  '../fixtures/api/check-runs/0d1a319a-check-runs.json',
).check_runs;
const FLAKY_REPRO_ONLY = readFixture(
  '../fixtures/api/check-runs/b9a64ded-check-runs.json',
).check_runs;
const CI_APP_FAILURES = readFixture(
  '../fixtures/api/check-runs/235dd237-check-runs.json',
).check_runs;
const SIMULTANEOUS_TIMESTAMP = readFixture(
  '../fixtures/api/check-runs/constructed-simultaneous-timestamp.json',
).check_runs;

/** A `GhApi` that serves one page (asserting it is never asked for a second). */
const singlePageGhApi = (checkRuns: readonly RawCheckRun[]): GhApi => ({
  get: <T>(path: string, params?: Record<string, string | number>) => {
    if (!path.endsWith('/check-runs')) {
      throw new Error(`unexpected GhApi.get call: ${path}`);
    }
    if (params?.page !== 1) {
      throw new Error(`unexpected second page requested: ${params?.page}`);
    }
    return Promise.resolve({ check_runs: checkRuns } as T);
  },
  getAll: () => {
    throw new Error('unexpected call to GhApi.getAll');
  },
});

describe('check-runs-facts.run', () => {
  it('reports every check-run when every name is unique, and flakyRepro absent (real: commit 0d1a319a)', async () => {
    const result = await run(singlePageGhApi(UNIQUE_NAMES), {
      sha: '0d1a319a106b2a791e883170782e856f88b0e178',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.checks).toHaveLength(UNIQUE_NAMES.length);
    expect(result.facts.ciApp).toEqual({ total: 7, notSuccess: [] });
    expect(result.facts.flakyRepro).toEqual({
      status: 'absent',
      conclusion: null,
    });
  });

  it('reports flakyRepro from the check-run named flaky-repro, and ciApp.total 0 when no ci-app-* run exists (real: commit b9a64ded)', async () => {
    const result = await run(singlePageGhApi(FLAKY_REPRO_ONLY), {
      sha: 'b9a64ded27e0ce4cc30a0563d5be5133db0f027a',
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        checks: [
          {
            id: 104055298998,
            name: 'flaky-repro',
            status: 'completed',
            conclusion: 'success',
            startedAt: '2026-09-14T16:17:00Z',
          },
        ],
        ciApp: { total: 0, notSuccess: [] },
        flakyRepro: { status: 'completed', conclusion: 'success' },
      },
    });
  });

  it('dedupes push+pull_request duplicates and reports ciApp.notSuccess for the newest-per-name failures (real: commit 235dd237)', async () => {
    const result = await run(singlePageGhApi(CI_APP_FAILURES), {
      sha: '235dd23767763951a25bbdb796e35be3d5c6c354',
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
    expect(result.facts.flakyRepro).toEqual({
      status: 'absent',
      conclusion: null,
    });
  });

  it('picks the larger id on an exact started_at tie (same-name, simultaneous timestamp)', async () => {
    const result = await run(singlePageGhApi(SIMULTANEOUS_TIMESTAMP), {
      sha: 'deadbeef',
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        checks: [
          {
            id: 100000000002,
            name: 'ci-app-test (24.x, 6.0)',
            status: 'completed',
            conclusion: 'success',
            startedAt: '2026-09-16T09:19:17Z',
          },
        ],
        ciApp: {
          total: 1,
          notSuccess: [],
        },
        flakyRepro: { status: 'absent', conclusion: null },
      },
    });
  });

  it('follows pagination across a full page before stopping on a short one', async () => {
    const fullPage: RawCheckRun[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      name: `ci-app-lint (${i})`,
      status: 'completed',
      conclusion: 'success',
      started_at: '2026-09-16T09:00:00Z',
    }));
    const shortPage: RawCheckRun[] = [
      {
        id: 101,
        name: 'flaky-repro',
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-09-16T09:05:00Z',
      },
    ];

    const requestedPages: number[] = [];
    const twoPageGhApi: GhApi = {
      get: <T>(path: string, params?: Record<string, string | number>) => {
        if (!path.endsWith('/check-runs')) {
          throw new Error(`unexpected GhApi.get call: ${path}`);
        }
        const page = Number(params?.page);
        requestedPages.push(page);
        return Promise.resolve({
          check_runs: page === 1 ? fullPage : shortPage,
        } as T);
      },
      getAll: () => {
        throw new Error('unexpected call to GhApi.getAll');
      },
    };

    const result = await run(twoPageGhApi, { sha: 'deadbeef' });

    expect(requestedPages).toEqual([1, 2]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.facts.checks).toHaveLength(101);
  });

  it('fails when the check-runs call fails outright', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: 404');
    const failingGhApi: GhApi = {
      get: () => Promise.reject(error),
      getAll: () => Promise.reject(error),
    };

    const result = await run(failingGhApi, { sha: 'deadbeef' });

    expect(result).toEqual({
      ok: false,
      failure: { reason: expect.stringContaining(error.message) },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');
    const buggyGhApi: GhApi = {
      get: () => Promise.reject(bug),
      getAll: () => Promise.reject(bug),
    };

    await expect(run(buggyGhApi, { sha: 'x' })).rejects.toBe(bug);
  });
});

describe('check-runs-facts.parseArgv', () => {
  it('requires --sha', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--sha is required',
    });
  });

  it('parses --sha', () => {
    expect(parseArgv(['--sha', 'abc'])).toEqual({
      kind: 'args',
      value: { sha: 'abc' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--sha', 'x', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('check-runs-facts CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--sha');
  });

  it('exits 2 with empty stdout when --sha is missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--sha is required');
  });
});
