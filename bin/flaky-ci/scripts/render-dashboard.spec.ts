import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { parseArgv, run } from './render-dashboard.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./render-dashboard.ts', import.meta.url),
);

const readFixture = (relativePath: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/${relativePath}`, import.meta.url)),
    'utf8',
  );

const REAL_INPUT_JSON = readFixture(
  'api/dashboard/render-dashboard-input.json',
);
const REAL_BODY = readFixture('api/dashboard/11720-body.md').replace(/\n$/, '');

const EMPTY_INPUT = JSON.stringify({
  updatedAt: '2026-09-16T00:00:00Z',
  issues: [],
  awaitingDecision: [],
  autoClosed: {
    closed: [],
    keptOpenByHumanReopen: [],
    skippedUnreadableDate: [],
  },
});

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

describe('render-dashboard.run', () => {
  it('returns the rendered body for the issue list the real dashboard was built from', () => {
    const result = run(REAL_INPUT_JSON);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.facts.body).toBe(REAL_BODY);
  });

  it('fails when stdin is empty — an empty body must not stand in for a rendered one', () => {
    const result = run('   \n');

    expect(result.ok).toBe(false);
  });

  it('fails when stdin does not parse as JSON', () => {
    const result = run('{not json');

    expect(result.ok).toBe(false);
  });

  it('fails when a required list is missing rather than rendering it as empty', () => {
    const result = run(
      JSON.stringify({ updatedAt: '2026-09-16T00:00:00Z', issues: [] }),
    );

    expect(result.ok).toBe(false);
  });
});

describe('render-dashboard CLI', () => {
  it('exits 0 on --help and says the input arrives on stdin', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);

    expect(stdout).toContain('stdin');
  });

  it('rejects positional arguments', () => {
    expect(parseArgv(['--issue', '1'])).toMatchObject({ kind: 'invalid' });
  });

  it('writes one line of JSON carrying the body on stdout and exits 0', async () => {
    const { stdout, stderr, code } = await runCli(EMPTY_INPUT);

    expect(code).toBe(0);
    expect(stderr).toBe('');
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.body).toContain('# flaky-ci-routine dashboard');
    expect(parsed.body).toContain('No active flaky tests right now.');
  });

  it('exits 2 with a reason on stderr when stdin is empty', async () => {
    const { stdout, stderr, code } = await runCli('');

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr.trim().length).toBeGreaterThan(0);
  });
});
