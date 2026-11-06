import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type GhApi, GhError } from '../lib/gh.ts';
import { parseArgv, run } from './lockfile-overlap.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./lockfile-overlap.ts', import.meta.url),
);

const readFixtureJson = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const readFixtureText = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

/** A `GhApi` whose `getAll` always returns the given PR files, verbatim. */
const fakeGhApi = (files: readonly unknown[]): GhApi => ({
  get: () => {
    throw new Error('unexpected call to GhApi.get in this test');
  },
  getAll: async () => files as never,
});

const failingGhApi = (error: unknown): GhApi => ({
  get: () => Promise.reject(error),
  getAll: () => Promise.reject(error),
});

const PR_11886_FILES = readFixtureJson(
  '../fixtures/api/pulls/11886-files.json',
) as readonly unknown[];
const LOG_EXCERPT_11849 = readFixtureText(
  '../fixtures/job-logs/11849-repro-result-log-excerpt.txt',
);

describe('lockfile-overlap.run', () => {
  it('returns the single overlapping name for the real PR #11886 / log #11849 pairing', async () => {
    const result = await run(
      fakeGhApi(PR_11886_FILES),
      () => LOG_EXCERPT_11849,
      {
        sha: 'a0b10af7a6e6b1b628a43506313b5cac5ae868b0',
        pr: '11886',
        logExcerptFile: 'ignored-in-test',
      },
    );

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        overlap: ['@codemirror/state'],
      },
    });
    if (result.ok) {
      expect(result.facts.patchPackages).toContain('@codemirror/state');
      expect(result.facts.logPackages).toEqual(
        [
          '@codemirror/state',
          '@testing-library/react',
          '@uiw/react-codemirror',
          'react',
          'react-dom',
        ].sort(),
      );
    }
  });

  it('returns every overlapping name, not just one, when more than one package overlaps', async () => {
    const files = [
      {
        filename: 'pnpm-lock.yaml',
        patch: "+  '@pkg/a@1.0.0':\n+  '@pkg/b@2.0.0':\n",
      },
    ];
    const result = await run(
      fakeGhApi(files),
      () =>
        '❯ node_modules/.pnpm/@pkg+a@1.0.0/node_modules/@pkg/a/index.js:1:1\n❯ node_modules/.pnpm/@pkg+b@2.0.0/node_modules/@pkg/b/index.js:1:1',
      {
        sha: 'deadbeef',
        pr: '1',
        logExcerptFile: 'ignored-in-test',
      },
    );

    expect(result).toMatchObject({
      ok: true,
      facts: { overlap: ['@pkg/a', '@pkg/b'] },
    });
  });

  it('succeeds with an empty overlap/patchPackages when the PR has no pnpm-lock.yaml among its files (the common case)', async () => {
    const files = [{ filename: 'apps/app/package.json', patch: 'irrelevant' }];
    const result = await run(
      fakeGhApi(files),
      () =>
        '❯ node_modules/.pnpm/@pkg+a@1.0.0/node_modules/@pkg/a/index.js:1:1',
      {
        sha: 'deadbeef',
        pr: '11846',
        logExcerptFile: 'ignored-in-test',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        overlap: [],
        patchPackages: [],
        logPackages: ['@pkg/a'],
      },
    });
  });

  it('turns a GhError into a failure result instead of throwing', async () => {
    const error = new GhError(
      'exit-nonzero',
      'gh api failed: Not Found (HTTP 404)',
    );

    const result = await run(failingGhApi(error), () => 'irrelevant', {
      sha: 'deadbeef',
      pr: '999999',
      logExcerptFile: 'ignored-in-test',
    });

    expect(result).toEqual({
      ok: false,
      failure: { reason: expect.stringContaining(error.message) },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');

    await expect(
      run(failingGhApi(bug), () => 'irrelevant', {
        sha: 'x',
        pr: '1',
        logExcerptFile: 'ignored-in-test',
      }),
    ).rejects.toBe(bug);
  });

  it('fails with exit-2 semantics when the log excerpt file cannot be read', async () => {
    const files = [
      { filename: 'pnpm-lock.yaml', patch: "+  '@pkg/a@1.0.0':\n" },
    ];
    const readFile = () => {
      throw new Error('ENOENT: no such file or directory');
    };

    const result = await run(fakeGhApi(files), readFile, {
      sha: 'deadbeef',
      pr: '1',
      logExcerptFile: '/no/such/file.txt',
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: expect.stringContaining('/no/such/file.txt') },
    });
  });
});

describe('lockfile-overlap.parseArgv', () => {
  it('requires --sha, --pr and --log-excerpt-file', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--sha, --pr and --log-excerpt-file are all required',
    });
    expect(parseArgv(['--sha', 'abc', '--pr', '1'])).toEqual({
      kind: 'invalid',
      reason: '--sha, --pr and --log-excerpt-file are all required',
    });
  });

  it('parses named flags in any order', () => {
    expect(
      parseArgv([
        '--pr',
        '11886',
        '--log-excerpt-file',
        'x.txt',
        '--sha',
        'abc',
      ]),
    ).toEqual({
      kind: 'args',
      value: { sha: 'abc', pr: '11886', logExcerptFile: 'x.txt' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--sha', 'x', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('lockfile-overlap CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--sha');
    expect(stdout).toContain('--pr');
    expect(stdout).toContain('--log-excerpt-file');
  });

  it('exits 2 with empty stdout when required flags are missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      '--sha, --pr and --log-excerpt-file are all required',
    );
  });
});
