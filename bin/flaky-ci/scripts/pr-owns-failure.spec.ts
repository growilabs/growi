import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type GhApi, GhError } from '../lib/gh.ts';
import {
  extractMergeQueuePrNumbers,
  matchesSpecPath,
  parseArgv,
  run,
} from './pr-owns-failure.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./pr-owns-failure.ts', import.meta.url),
);

const readFixtureJson = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const COMPARE_IDENTICAL = readFixtureJson(
  '../fixtures/api/compare/master-identical-0d1a319a.json',
) as { status: string };
const COMPARE_DIVERGED = readFixtureJson(
  '../fixtures/api/compare/master-diverged-807c3628.json',
) as { status: string };
const PULLS_0D1A319A = readFixtureJson(
  '../fixtures/api/commits/0d1a319a-pulls.json',
) as readonly unknown[];
const PULLS_807C3628 = readFixtureJson(
  '../fixtures/api/commits/807c3628-pulls.json',
) as readonly unknown[];
const EMPTY_PULLS = readFixtureJson(
  '../fixtures/api/commits/constructed-empty-pulls.json',
) as readonly unknown[];
const MERGE_QUEUE_COMMIT = readFixtureJson(
  '../fixtures/api/commits/constructed-merge-queue-commit.json',
) as { commit: { message: string } };
const BATCHED_MERGE_QUEUE_COMMIT = readFixtureJson(
  '../fixtures/api/commits/constructed-batched-merge-queue-commit.json',
) as { commit: { message: string } };
const NO_PR_COMMIT = readFixtureJson(
  '../fixtures/api/commits/constructed-no-pr-commit.json',
) as { commit: { message: string } };
const TWO_PRS = readFixtureJson(
  '../fixtures/api/commits/constructed-two-prs-pulls.json',
) as readonly unknown[];
const FILES_11919 = readFixtureJson(
  '../fixtures/api/pulls/11919-files.json',
) as readonly { filename: string }[];
const FILES_11920 = readFixtureJson(
  '../fixtures/api/pulls/11920-files.json',
) as readonly { filename: string }[];
const PR_100_FILES = readFixtureJson(
  '../fixtures/api/pulls/constructed-pr-100-files.json',
) as readonly { filename: string }[];
const PR_200_FILES = readFixtureJson(
  '../fixtures/api/pulls/constructed-pr-200-files.json',
) as readonly { filename: string }[];

type Routes = {
  readonly compare?: unknown;
  readonly compareError?: unknown;
  readonly directPulls?: readonly unknown[];
  readonly directPullsError?: unknown;
  readonly commitMessage?: { commit: { message: string } };
  readonly commitMessageError?: unknown;
  readonly filesByPr?: Readonly<
    Record<number, readonly { filename: string }[]>
  >;
  readonly filesError?: unknown;
};

/** A `GhApi` that dispatches by path shape, matching the real endpoints this script calls. */
const routedGhApi = (routes: Routes): GhApi => ({
  get: <T>(path: string): Promise<T> => {
    if (path.includes('/compare/')) {
      return routes.compareError != null
        ? Promise.reject(routes.compareError)
        : Promise.resolve(routes.compare as T);
    }
    if (/\/commits\/[^/]+$/.test(path)) {
      return routes.commitMessageError != null
        ? Promise.reject(routes.commitMessageError)
        : Promise.resolve(routes.commitMessage as T);
    }
    return Promise.reject(new Error(`unexpected GhApi.get call: ${path}`));
  },
  getAll: <T>(path: string): Promise<readonly T[]> => {
    if (path.endsWith('/pulls')) {
      return routes.directPullsError != null
        ? Promise.reject(routes.directPullsError)
        : Promise.resolve((routes.directPulls ?? []) as readonly T[]);
    }
    const filesMatch = path.match(/\/pulls\/(\d+)\/files$/);
    if (filesMatch != null) {
      if (routes.filesError != null) {
        return Promise.reject(routes.filesError);
      }
      const number = Number(filesMatch[1]);
      return Promise.resolve(
        (routes.filesByPr?.[number] ?? []) as readonly T[],
      );
    }
    return Promise.reject(new Error(`unexpected GhApi.getAll call: ${path}`));
  },
});

describe('pr-owns-failure.run', () => {
  it('ancestor exists, PR exists, spec path matches (real: commit 0d1a319a, PR #11920)', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_IDENTICAL,
        directPulls: PULLS_0D1A319A,
        filesByPr: { 11920: FILES_11920 },
      }),
      {
        sha: '0d1a319a106b2a791e883170782e856f88b0e178',
        specPath: '.kiro/specs/i18n-community-translation/tasks.md',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'identical',
        pulls: [
          { number: 11920, base: 'master', state: 'closed', touchesSpec: true },
        ],
        touchesSpec: true,
        noPr: false,
      },
    });
  });

  it('ancestor exists, PR exists, spec path does not match', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_IDENTICAL,
        directPulls: PULLS_0D1A319A,
        filesByPr: { 11920: FILES_11920 },
      }),
      {
        sha: '0d1a319a106b2a791e883170782e856f88b0e178',
        specPath: 'src/unrelated/file.spec.ts',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'identical',
        pulls: [
          {
            number: 11920,
            base: 'master',
            state: 'closed',
            touchesSpec: false,
          },
        ],
        touchesSpec: false,
        noPr: false,
      },
    });
  });

  it('ancestor exists, no PR at all', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_IDENTICAL,
        directPulls: EMPTY_PULLS,
        commitMessage: NO_PR_COMMIT,
      }),
      {
        sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        specPath: 'src/whatever.spec.ts',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'identical',
        pulls: [],
        touchesSpec: false,
        noPr: true,
      },
    });
  });

  it('ancestor does not exist, PR exists, spec path matches (real: commit 807c3628, PR #11919)', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: PULLS_807C3628,
        filesByPr: { 11919: FILES_11919 },
      }),
      {
        sha: '807c3628fc85bbf29335840d004660ce8c195f64',
        specPath: 'src/features/backlinks/server/services/page-link-sync.ts',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [
          {
            number: 11919,
            base: 'feat/185872-backlinks',
            state: 'open',
            touchesSpec: true,
          },
        ],
        touchesSpec: true,
        noPr: false,
      },
    });
  });

  it('ancestor does not exist, PR exists, spec path does not match (real: commit 807c3628, PR #11919)', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: PULLS_807C3628,
        filesByPr: { 11919: FILES_11919 },
      }),
      {
        sha: '807c3628fc85bbf29335840d004660ce8c195f64',
        specPath: 'src/some/unrelated/file.spec.ts',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [
          {
            number: 11919,
            base: 'feat/185872-backlinks',
            state: 'open',
            touchesSpec: false,
          },
        ],
        touchesSpec: false,
        noPr: false,
      },
    });
  });

  it('ancestor does not exist, no PR at all (direct push to a feature branch)', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: EMPTY_PULLS,
        commitMessage: NO_PR_COMMIT,
      }),
      {
        sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        specPath: 'src/whatever.spec.ts',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [],
        touchesSpec: false,
        noPr: true,
      },
    });
  });

  it('checks every associated PR, not just the first — only a LATER PR touches the spec path', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: TWO_PRS,
        filesByPr: { 100: PR_100_FILES, 200: PR_200_FILES },
      }),
      {
        sha: 'ffffffffffffffffffffffffffffffffffffff',
        specPath: 'src/features/backlinks/server/services/page-link-sync.ts',
      },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [
          { number: 100, base: 'master', state: 'closed', touchesSpec: false },
          {
            number: 200,
            base: 'feat/some-branch',
            state: 'open',
            touchesSpec: true,
          },
        ],
        touchesSpec: true,
        noPr: false,
      },
    });
  });

  it('falls back to the merge-queue commit message when commits/{sha}/pulls is empty', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: EMPTY_PULLS,
        commitMessage: MERGE_QUEUE_COMMIT,
      }),
      { sha: 'cccccccccccccccccccccccccccccccccccccc', specPath: '' },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [{ number: 12345, base: null, state: null, touchesSpec: false }],
        touchesSpec: false,
        noPr: false,
      },
    });
  });

  it('extracts every "Merge of #{N}" line when Mergify batches several PRs into one queue commit', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: EMPTY_PULLS,
        commitMessage: BATCHED_MERGE_QUEUE_COMMIT,
      }),
      { sha: 'dddddddddddddddddddddddddddddddddddddd', specPath: '' },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [
          { number: 100, base: null, state: null, touchesSpec: false },
          { number: 200, base: null, state: null, touchesSpec: false },
        ],
        touchesSpec: false,
        noPr: false,
      },
    });
  });

  it('never excludes a Playwright job-level identity (empty --spec-path) — touchesSpec stays false without fetching files', async () => {
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: PULLS_807C3628,
        // No `filesByPr` entry for 11919 — if the script fetched files
        // despite the empty spec path, `routedGhApi` would throw.
      }),
      { sha: '807c3628fc85bbf29335840d004660ce8c195f64', specPath: '' },
    );

    expect(result).toEqual({
      ok: true,
      facts: {
        ancestryStatus: 'diverged',
        pulls: [
          {
            number: 11919,
            base: 'feat/185872-backlinks',
            state: 'open',
            touchesSpec: false,
          },
        ],
        touchesSpec: false,
        noPr: false,
      },
    });
  });

  it('fails with exit-2 semantics (via the failure shape) when the compare call fails', async () => {
    const error = new GhError(
      'exit-nonzero',
      'gh api failed: Not Found (HTTP 404)',
    );
    const result = await run(routedGhApi({ compareError: error }), {
      sha: 'deadbeef',
      specPath: 'src/whatever.spec.ts',
    });

    expect(result).toEqual({
      ok: false,
      failure: { reason: expect.stringContaining(error.message) },
    });
  });

  it('fails when commits/{sha}/pulls fails', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: 500');
    const result = await run(
      routedGhApi({ compare: COMPARE_DIVERGED, directPullsError: error }),
      { sha: 'deadbeef', specPath: 'src/whatever.spec.ts' },
    );

    expect(result).toEqual({
      ok: false,
      failure: { reason: expect.stringContaining(error.message) },
    });
  });

  it('fails when the merge-queue commit-message fallback fetch fails', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: 404');
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: EMPTY_PULLS,
        commitMessageError: error,
      }),
      { sha: 'deadbeef', specPath: 'src/whatever.spec.ts' },
    );

    expect(result).toEqual({
      ok: false,
      failure: { reason: expect.stringContaining(error.message) },
    });
  });

  it('fails when a PR files fetch fails', async () => {
    const error = new GhError('exit-nonzero', 'gh api failed: 404');
    const result = await run(
      routedGhApi({
        compare: COMPARE_DIVERGED,
        directPulls: PULLS_807C3628,
        filesError: error,
      }),
      {
        sha: '807c3628fc85bbf29335840d004660ce8c195f64',
        specPath: 'src/whatever.spec.ts',
      },
    );

    expect(result).toEqual({
      ok: false,
      failure: { reason: expect.stringContaining(error.message) },
    });
  });

  it('lets an unexpected (non-GhError) error propagate rather than mislabeling it', async () => {
    const bug = new TypeError('something else went wrong');
    await expect(
      run(routedGhApi({ compareError: bug }), {
        sha: 'x',
        specPath: 'src/whatever.spec.ts',
      }),
    ).rejects.toBe(bug);
  });
});

describe('pr-owns-failure.extractMergeQueuePrNumbers', () => {
  it('extracts only literal "Merge of #{N}" lines, never a stray #{N} token', () => {
    expect(
      extractMergeQueuePrNumbers(MERGE_QUEUE_COMMIT.commit.message),
    ).toEqual([12345]);
  });

  it('extracts every line when several PRs are batched into one queue commit', () => {
    expect(
      extractMergeQueuePrNumbers(BATCHED_MERGE_QUEUE_COMMIT.commit.message),
    ).toEqual([100, 200]);
  });

  it('returns an empty array for an ordinary commit message', () => {
    expect(extractMergeQueuePrNumbers(NO_PR_COMMIT.commit.message)).toEqual([]);
  });
});

describe('pr-owns-failure.matchesSpecPath', () => {
  it('matches by suffix, not equality, and never matches an empty spec path', () => {
    expect(
      matchesSpecPath(
        'apps/app/src/features/backlinks/server/services/page-link-sync.ts',
        'src/features/backlinks/server/services/page-link-sync.ts',
      ),
    ).toBe(true);
    expect(matchesSpecPath('apps/app/src/foo.ts', 'src/foo.ts')).toBe(true);
    expect(matchesSpecPath('apps/app/src/foo.ts', 'src/bar.ts')).toBe(false);
    expect(matchesSpecPath('anything.ts', '')).toBe(false);
  });
});

describe('pr-owns-failure.parseArgv', () => {
  it('requires --sha and --spec-path', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--sha and --spec-path are both required',
    });
    expect(parseArgv(['--sha', 'abc'])).toEqual({
      kind: 'invalid',
      reason: '--sha and --spec-path are both required',
    });
  });

  it('accepts an explicitly empty --spec-path (Playwright job-level identity)', () => {
    expect(parseArgv(['--sha', 'abc', '--spec-path', ''])).toEqual({
      kind: 'args',
      value: { sha: 'abc', specPath: '' },
    });
  });

  it('parses named flags in any order', () => {
    expect(parseArgv(['--spec-path', 'x.ts', '--sha', 'abc'])).toEqual({
      kind: 'args',
      value: { sha: 'abc', specPath: 'x.ts' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--sha', 'x', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('pr-owns-failure CLI process', () => {
  it('exits 0 on --help without contacting GitHub', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--sha');
    expect(stdout).toContain('--spec-path');
  });

  it('exits 2 with empty stdout when required flags are missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--sha and --spec-path are both required');
  });
});
