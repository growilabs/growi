import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './read-repro-result.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./read-repro-result.ts', import.meta.url),
);

const readFixture = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

/** A `GhApi` whose `getAll` always returns the given comments, verbatim. */
const fakeGhApi = (comments: readonly unknown[]): GhApi => ({
  get: () => {
    throw new Error('unexpected call to GhApi.get in this test');
  },
  getAll: async () => comments as never,
});

const failingGhApi = (error: unknown): GhApi => ({
  get: () => Promise.reject(error),
  getAll: () => Promise.reject(error),
});

const CASE1_ISSUE = '11823';
const CASE1_SHA = 'b9a64ded27e0ce4cc30a0563d5be5133db0f027a';
const CASE2_SHA = '89af5caf24803880c8b4f198a4efed956694cc55';

describe('read-repro-result.run', () => {
  it('returns the tally for a commit with a single matching comment (case 1)', async () => {
    const comments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(comments), {
      issue: CASE1_ISSUE,
      sha: CASE1_SHA,
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        runs: 3,
        failed: 0,
        perRun: ['pass', 'pass', 'pass'],
        workflowRunUrl:
          'https://github.com/growilabs/growi/actions/runs/34867613127',
        commentUrl:
          'https://github.com/growilabs/growi/issues/11823#issuecomment-5667125454',
      },
    });
  });

  it('returns the tally for the second commit on the same issue (case 2)', async () => {
    const comments = readFixture(
      '../fixtures/api/issues/11823-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(comments), {
      issue: CASE1_ISSUE,
      sha: CASE2_SHA,
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        runs: 3,
        failed: 0,
        perRun: ['pass', 'pass', 'pass'],
        workflowRunUrl:
          'https://github.com/growilabs/growi/actions/runs/34867631668',
        commentUrl:
          'https://github.com/growilabs/growi/issues/11823#issuecomment-5667128399',
      },
    });
  });

  it('picks the newer of two comments naming the same commit (case 3, synthetic re-run)', async () => {
    const pages = readFixture(
      '../fixtures/api/issues/synthetic-duplicate-sha-repro-result.slurp.json',
    ) as readonly (readonly unknown[])[];
    const comments = pages[0];

    const result = await run(fakeGhApi(comments), {
      issue: CASE1_ISSUE,
      sha: CASE1_SHA,
    });

    expect(result).toEqual({
      ok: true,
      facts: {
        runs: 3,
        failed: 1,
        perRun: ['pass', 'fail', 'pass'],
        workflowRunUrl:
          'https://github.com/growilabs/growi/actions/runs/34867699999',
        commentUrl:
          'https://github.com/growilabs/growi/issues/11823#issuecomment-9999999001',
      },
    });
  });

  it('fails with exit-2 semantics when no comment on the issue carries that commit (case 4)', async () => {
    const comments = readFixture(
      '../fixtures/api/issues/11821-comments.json',
    ) as readonly unknown[];

    const result = await run(fakeGhApi(comments), {
      issue: '11821',
      sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      failure: {
        reason: expect.stringContaining('11821'),
      },
    });
  });

  it('turns a GhError into a failure result instead of throwing', async () => {
    const error = new GhError(
      'exit-nonzero',
      'gh api failed: Not Found (HTTP 404)',
    );

    const result = await run(failingGhApi(error), {
      issue: '999999',
      sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });

    expect(result).toEqual({
      ok: false,
      failure: { reason: error.message },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');

    await expect(run(failingGhApi(bug), { issue: '1', sha: 'x' })).rejects.toBe(
      bug,
    );
  });
});

describe('read-repro-result.parseArgv', () => {
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

  it('parses named flags in any order', () => {
    expect(parseArgv(['--sha', 'abc', '--issue', '11823'])).toEqual({
      kind: 'args',
      value: { issue: '11823', sha: 'abc' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--issue', '1', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('read-repro-result CLI process', () => {
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
