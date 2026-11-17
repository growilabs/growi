import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { type ParseJobLogPlaywright, parseArgv, run } from './parse-job-log.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./parse-job-log.ts', import.meta.url),
);

const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/job-logs/${name}`, import.meta.url)),
    'utf8',
  );

const CI_APP_TEST = readFixture('ci-app-test-100952911197-excerpt.txt');
const PLAYWRIGHT_11903 = readFixture('11903-playwright-flaky-excerpt.txt');
const PLAYWRIGHT_11914 = readFixture('11914-playwright-flaky-excerpt.txt');
const PLAYWRIGHT_TWO_FLAKY = readFixture(
  '39935584265-playwright-two-flaky-excerpt.txt',
);
const PLAYWRIGHT_TWO_RUNS = readFixture(
  '43419616882-playwright-flaky-two-runs-excerpt.txt',
);
const PLAYWRIGHT_FAILED_ALL_ATTEMPTS = readFixture(
  '41984122671-playwright-failed-all-attempts-excerpt.txt',
);
const PLAYWRIGHT_COUNT_MISMATCH = readFixture(
  'constructed-playwright-flaky-count-mismatch-excerpt.txt',
);
const MANY_FAILURES = readFixture(
  'constructed-97-failures-one-infra-noise-excerpt.txt',
);
const SETUP_HOOK_NOISE = readFixture(
  'constructed-setup-hook-infra-noise-excerpt.txt',
);

const playwrightRuns = (
  result: ReturnType<typeof run>,
): ParseJobLogPlaywright['runs'] => {
  if (!result.ok) {
    throw new Error('expected an ok result');
  }
  const { playwright } = result.facts;
  if (playwright == null || !('runs' in playwright)) {
    throw new Error('expected a playwright.runs field');
  }
  return playwright.runs as ParseJobLogPlaywright['runs'];
};

/** Runs the CLI in a real child process with `input` on stdin. */
const runCli = async (
  input: string,
  args: readonly string[] = [],
): Promise<{ stdout: string; stderr: string; code: number }> => {
  const child = execFileAsync('node', [scriptPath, ...args]);
  child.child.stdin?.end(input);
  try {
    const { stdout, stderr } = await child;
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout: string; stderr: string; code: number };
    return {
      stdout: failure.stdout,
      stderr: failure.stderr,
      code: failure.code,
    };
  }
};

describe('parse-job-log.run', () => {
  it('returns vitest fail blocks, no Playwright run and no denylist hit for a real vitest job log', () => {
    const result = run(CI_APP_TEST);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.facts.vitest).toMatchObject({
      failBlocks: expect.any(Array),
    });
    const vitest = result.facts.vitest as { failBlocks: readonly unknown[] };
    expect(vitest.failBlocks).toHaveLength(5);
    expect(result.facts.playwright).toEqual({ runs: [] });
    expect(result.facts.denylistHits).toEqual([]);
  });

  it('returns each flaky test of a real shard log with the identity key built from it', () => {
    const result = run(PLAYWRIGHT_11914);

    expect(result).toMatchObject({
      ok: true,
      facts: {
        playwright: {
          runs: [
            {
              counts: { failed: 0, flaky: 1, passed: 106, skipped: 0 },
              flaky: {
                kind: 'read',
                tests: [{ identityKey: expect.stringMatching(/^playwright:/) }],
              },
              failed: { kind: 'read', tests: [] },
            },
          ],
        },
      },
    });
  });

  it('gives the flaky test of issue 11914 the identity key its tracking issue is titled with', () => {
    const result = run(PLAYWRIGHT_11914);

    expect(playwrightRuns(result)[0]?.flaky).toMatchObject({
      kind: 'read',
      tests: [
        {
          identityKey:
            'playwright:chromium:playwright/20-basic-features/inline-comment.spec.ts:Inline comment - hover/click/tap on a saved body highlight opens a preview popover with simple reply (Req 2.1-2.5) > Requirement 2.3: submitting a reply from the popover posts it, and it appears nested under the origin item in the bottom list',
        },
      ],
    });
  });

  it('keeps the normal run and the guest-mode run of one job apart, each with its own counts and excerpt', () => {
    const runs = playwrightRuns(run(PLAYWRIGHT_TWO_RUNS));

    expect(runs.map((r) => r.counts)).toEqual([
      { failed: 0, flaky: 1, passed: 119, skipped: 0 },
      { failed: 0, flaky: 0, passed: 3, skipped: 0 },
    ]);
    expect(runs[0]?.excerpt).toContain('1 flaky');
    expect(runs[0]?.excerpt).toContain(
      'create-page-button.spec.ts:23:3 › Create page button dropdown menu',
    );
    expect(runs[1]?.excerpt).not.toContain('create-page-button');
  });

  it('returns a test that failed every attempt under failed, with its identity key', () => {
    const runs = playwrightRuns(run(PLAYWRIGHT_FAILED_ALL_ATTEMPTS));

    expect(runs[0]?.failed).toMatchObject({
      kind: 'read',
      tests: [
        {
          identityKey: expect.stringContaining(
            'playwright:chromium:playwright/20-basic-features/inline-comment.spec.ts:',
          ),
        },
      ],
    });
    expect(runs[0]?.flaky).toEqual({ kind: 'read', tests: [] });
  });

  it('passes an unreadable list through with its reason and no identity keys', () => {
    const runs = playwrightRuns(run(PLAYWRIGHT_COUNT_MISMATCH));

    expect(runs[0]?.flaky).toEqual({
      kind: 'unreadable',
      reason: 'count-mismatch',
    });
  });

  it('reports the list of a `1 flaky` summary with no test line under it as unreadable', () => {
    const runs = playwrightRuns(run(PLAYWRIGHT_11903));

    expect(runs).toHaveLength(1);
    expect(runs[0]?.counts).toEqual({
      failed: 0,
      flaky: 1,
      passed: 106,
      skipped: 0,
    });
    expect(runs[0]?.flaky).toEqual({
      kind: 'unreadable',
      reason: 'count-mismatch',
    });
  });

  it('gives each of two flaky tests an identity key built from its own spec path and title', () => {
    const runs = playwrightRuns(run(PLAYWRIGHT_TWO_FLAKY));

    expect(runs[0]?.flaky).toMatchObject({
      kind: 'read',
      tests: [
        {
          identityKey:
            'playwright:firefox:playwright/20-basic-features/create-page-button.spec.ts:Create page button dropdown menu > open and create today page',
        },
        {
          identityKey:
            'playwright:firefox:playwright/20-basic-features/inline-comment.spec.ts:Inline comment - hover-to-popover transit and popover-lock timing (Req 15.7-15.9); resolve from the popover and click-path regression (Req 15.10, 4.6) > Req 15.1, 15.4: clicking the highlight still opens the popover immediately, with no visible delay, and it stays open with no further interaction',
        },
      ],
    });
  });

  it('reports exactly one denylist hit, scoped to that failure, among 97 failures', () => {
    const result = run(MANY_FAILURES);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.facts.denylistHits).toEqual([
      {
        blockIndex: 42,
        specPath: 'src/server/service/feature-43/feature-43.integ.ts',
        testTitle: 'feature-43 suite > case 43 keeps its own identity',
        pattern: 'getaddrinfo ENOTFOUND',
        needle: 'getaddrinfo ENOTFOUND',
        scope: 'failure',
      },
    ]);
  });

  it('reports a denylist hit inside a shared setup hook with job scope', () => {
    const result = run(SETUP_HOOK_NOISE);

    expect(result).toMatchObject({
      ok: true,
      facts: {
        denylistHits: [{ blockIndex: 0, scope: 'job' }],
      },
    });
  });

  it('fails with exit-code-2 semantics on empty input rather than returning zero rows', () => {
    expect(run('')).toMatchObject({ ok: false });
    expect(run('   \n\t\n')).toMatchObject({ ok: false });
  });
});

describe('parse-job-log.parseArgv', () => {
  it('treats --help as its own outcome', () => {
    expect(parseArgv(['--help'])).toEqual({ kind: 'help' });
  });

  it('takes no arguments: anything else is invalid', () => {
    expect(parseArgv([])).toEqual({ kind: 'args' });
    expect(parseArgv(['--job-id', '123'])).toMatchObject({ kind: 'invalid' });
  });
});

describe('parse-job-log CLI process', () => {
  it('exits 0 on --help and says the log arrives on stdin', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);

    expect(stdout).toContain('stdin');
  });

  it('parses the same log identically whether it came from gh or an MCP tool result', async () => {
    const { stdout, code } = await runCli(PLAYWRIGHT_11914);

    expect(code).toBe(0);
    const facts = JSON.parse(stdout) as {
      ok: boolean;
      playwright: { runs: { counts: unknown }[] };
    };
    expect(facts.ok).toBe(true);
    expect(facts.playwright.runs.map((r) => r.counts)).toEqual([
      { failed: 0, flaky: 1, passed: 106, skipped: 0 },
    ]);
  });

  it('exits 2 with empty stdout when stdin is empty', async () => {
    const { stdout, stderr, code } = await runCli('');

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('stdin');
  });

  it('exits 2 when stdin carries only whitespace', async () => {
    const { stdout, code } = await runCli('  \n  \n');

    expect(code).toBe(2);
    expect(stdout).toBe('');
  });
});
