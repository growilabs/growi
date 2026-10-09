import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './newest-observation.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./newest-observation.ts', import.meta.url),
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

describe('newest-observation.run', () => {
  it('returns the body date when there are no observation comments (case 1, issue #11900)', async () => {
    const issue = readFixture('../fixtures/api/issues/11900-issue.json');
    const comments = readFixture(
      '../fixtures/api/issues/11900-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(issue, comments), { issue: '11900' });

    expect(result).toEqual({
      ok: true,
      facts: { newest: '2026-09-11T17:47:16Z', source: 'body' },
    });
  });

  it('returns the newest observation comment date when it is newer than the body (case 2, issue #11821)', async () => {
    const issue = readFixture('../fixtures/api/issues/11821-issue.json');
    const comments = readFixture(
      '../fixtures/api/issues/11821-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(issue, comments), { issue: '11821' });

    expect(result).toEqual({
      ok: true,
      facts: { newest: '2026-09-02T15:43:58Z', source: 5518389941 },
    });
  });

  it('fails with exit-2 semantics when no Date: line can be read anywhere (case 3, synthetic)', async () => {
    const issue = readFixture(
      '../fixtures/api/issues/synthetic-no-date-issue.json',
    );
    const comments = readFixture(
      '../fixtures/api/issues/synthetic-no-date-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(issue, comments), {
      issue: 'synthetic',
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: expect.stringContaining('synthetic') },
    });
  });

  it('fails instead of reporting a fabricated success when the ONLY candidate (body) has a malformed Date: value', async () => {
    // Regression: Array.prototype.reduce with a single-element array and no seed
    // never invokes the comparator, so a lone malformed candidate used to sail
    // through uncompared and come back as `ok: true`.
    const issue = {
      body: '### First observation\n\n- Date: not-a-date\n',
    };
    const comments: unknown[] = [];

    const result = await run(fakeGhApi(issue, comments), { issue: '1' });

    expect(result.ok).toBe(false);
  });

  it('fails instead of reporting a fabricated success when the ONLY candidate (a comment) has a malformed Date: value', async () => {
    const issue = { body: 'no ### First observation section here' };
    const comments = [
      {
        id: 42,
        body: '### Additional observation\n\n- Date: not-a-date\n',
      },
    ];

    const result = await run(fakeGhApi(issue, comments), { issue: '1' });

    expect(result.ok).toBe(false);
  });

  it('ignores a non-observation comment even when it contains a Date:-shaped line', async () => {
    const issue = { body: 'no ### First observation section here' };
    const comments = [
      {
        id: 1,
        body: '### Repro result\n\n- Commit: abc\n- Date: 2026-01-01T00:00:00Z\n',
      },
    ];

    const result = await run(fakeGhApi(issue, comments), { issue: '1' });

    expect(result.ok).toBe(false);
  });

  it('turns a GhError into a failure result instead of throwing', async () => {
    const error = new GhError(
      'exit-nonzero',
      'gh api failed: Not Found (HTTP 404)',
    );

    const result = await run(failingGhApi(error), { issue: '999999' });

    expect(result).toEqual({
      ok: false,
      failure: { reason: error.message },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');

    await expect(run(failingGhApi(bug), { issue: '1' })).rejects.toBe(bug);
  });
});

describe('newest-observation.parseArgv', () => {
  it('requires --issue', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--issue is required',
    });
  });

  it('parses --issue', () => {
    expect(parseArgv(['--issue', '11900'])).toEqual({
      kind: 'args',
      value: { issue: '11900' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--issue', '1', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('newest-observation CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--issue');
  });

  it('exits 2 with empty stdout when --issue is missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--issue is required');
  });
});
