import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './occurrence-summary.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./occurrence-summary.ts', import.meta.url),
);

const readFixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

/** A `GhApi` whose `get` returns the given issue and `getAll` the given comments. */
const fakeGhApi = (issue: unknown, comments: readonly unknown[]): GhApi => ({
  get: async () => issue as never,
  getAll: async () => comments as never,
});

const failingGhApi = (error: unknown): GhApi => ({
  get: () => Promise.reject(error),
  getAll: () => Promise.reject(error),
});

describe('occurrence-summary.run', () => {
  it('reports the body-only occurrence summary for one issue (issue #11900)', async () => {
    const issue = readFixture('../fixtures/api/issues/11900-issue.json');
    const comments = readFixture(
      '../fixtures/api/issues/11900-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(issue, comments), { issue: '11900' });

    expect(result).toEqual({
      ok: true,
      facts: {
        firstSeen: '2026-09-11T17:47:16Z',
        lastSeen: '2026-09-11T17:47:16Z',
        occurrences: 1,
      },
    });
  });

  it('reports firstSeen/lastSeen spanning multiple observation comments (issue #11821)', async () => {
    const issue = readFixture('../fixtures/api/issues/11821-issue.json');
    const comments = readFixture(
      '../fixtures/api/issues/11821-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(issue, comments), { issue: '11821' });

    expect(result).toEqual({
      ok: true,
      facts: {
        firstSeen: '2026-08-27T12:49:11Z',
        lastSeen: '2026-09-02T15:43:58Z',
        occurrences: 3,
      },
    });
  });

  it('reports firstSeen/lastSeen null with occurrences 1 when no observation date can be read', async () => {
    const issue = {
      number: 1,
      title: 'flaky: vitest:src/a.integ.ts:does a thing',
      body: 'no observation section here',
      labels: [],
    };

    const result = await run(fakeGhApi(issue, []), { issue: '1' });

    expect(result).toEqual({
      ok: true,
      facts: { firstSeen: null, lastSeen: null, occurrences: 1 },
    });
  });

  it('fails the whole call (no partial row) when fetching the issue raises a GhError', async () => {
    const error = new GhError(
      'exit-nonzero',
      'gh api failed: Not Found (HTTP 404)',
    );

    const result = await run(failingGhApi(error), { issue: '99999' });

    expect(result).toEqual({
      ok: false,
      failure: { reason: error.message },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');
    const ghApi: GhApi = {
      get: () => Promise.reject(bug),
      getAll: () => Promise.reject(bug),
    };

    await expect(run(ghApi, { issue: '1' })).rejects.toBe(bug);
  });
});

describe('occurrence-summary.parseArgv', () => {
  it('requires --issue', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--issue is required',
    });
  });

  it('reads a single --issue value', () => {
    expect(parseArgv(['--issue', '11823'])).toEqual({
      kind: 'args',
      value: { issue: '11823' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--issue', '1', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('occurrence-summary CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--issue');
  });

  it('exits 2 with empty stdout when --issue is omitted', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--issue is required');
  });
});
