import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { parseArgv, run } from './parse-job-log.ts';

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
const MANY_FAILURES = readFixture(
  'constructed-97-failures-one-infra-noise-excerpt.txt',
);
const SETUP_HOOK_NOISE = readFixture(
  'constructed-setup-hook-infra-noise-excerpt.txt',
);

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
  it('returns vitest fail blocks, an empty annotation list and no summary for a real vitest job log', () => {
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
    expect(result.facts.playwright).toEqual({ annotations: [], summary: null });
    expect(result.facts.denylistHits).toEqual([]);
  });

  it('returns the Playwright annotation and summary for a real shard log', () => {
    const result = run(PLAYWRIGHT_11903);

    expect(result).toMatchObject({
      ok: true,
      facts: {
        playwright: {
          annotations: [
            {
              file: 'apps/app/playwright/20-basic-features/inline-comment.spec.ts',
              title: expect.stringContaining('DARK mode (Req 4.4)'),
            },
          ],
          summary: { failed: 0, flaky: 1, passed: 106, skipped: 0 },
        },
      },
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
    const { stdout, code } = await runCli(PLAYWRIGHT_11903);

    expect(code).toBe(0);
    const facts = JSON.parse(stdout) as {
      ok: boolean;
      playwright: { summary: unknown };
    };
    expect(facts.ok).toBe(true);
    expect(facts.playwright.summary).toEqual({
      failed: 0,
      flaky: 1,
      passed: 106,
      skipped: 0,
    });
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
