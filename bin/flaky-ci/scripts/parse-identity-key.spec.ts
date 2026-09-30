import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { parseArgv, run } from './parse-identity-key.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./parse-identity-key.ts', import.meta.url),
);

const readFixtureJson = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const REAL_TITLES = readFixtureJson(
  '../fixtures/identity/flaky-issue-titles.json',
) as readonly string[];

const EXPECTED_REAL_TITLES = readFixtureJson(
  '../fixtures/expected/parse-identity-key-titles.json',
) as ReadonlyArray<{
  readonly title: string;
  readonly parsed: {
    readonly shape: string;
    readonly kind: string | null;
    readonly browser: string | null;
    readonly specPath: string | null;
    readonly testTitle: string | null;
  };
}>;

describe('parse-identity-key.run', () => {
  it('returns the same fields for every real title as the recorded expectation', () => {
    for (const { title, parsed } of EXPECTED_REAL_TITLES) {
      const result = run({ title });
      expect(result).toEqual({
        ok: true,
        facts: {
          kind: parsed.kind,
          browser: parsed.browser,
          specPath: parsed.specPath,
          testTitle: parsed.testTitle,
          shape: parsed.shape,
        },
      });
    }
  });

  it('never fails for a job-level fallback or malformed key — the shape itself is the fact', () => {
    expect(run({ title: 'flaky: playwright:chromium' })).toEqual({
      ok: true,
      facts: {
        kind: 'playwright',
        browser: 'chromium',
        specPath: null,
        testTitle: null,
        shape: 'playwright-job-level',
      },
    });
    expect(run({ title: 'flaky: vitest:no-extension-here' })).toEqual({
      ok: true,
      facts: {
        kind: 'vitest',
        browser: null,
        specPath: null,
        testTitle: null,
        shape: 'malformed',
      },
    });
  });
});

describe('parse-identity-key.parseArgv', () => {
  it('requires --title', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--title is required',
    });
  });

  it('parses --title', () => {
    expect(parseArgv(['--title', 'flaky: vitest:src/foo.spec.ts:t'])).toEqual({
      kind: 'args',
      value: { title: 'flaky: vitest:src/foo.spec.ts:t' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--title', 'x', '--help'])).toEqual({ kind: 'help' });
  });
});

describe('parse-identity-key CLI process', () => {
  it('exits 0 on --help without requiring --title', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('--title');
    expect(stdout).toContain('shape');
  });

  it('exits 2 with empty stdout when --title is missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error as { stdout: string; stderr: string; code: number },
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--title is required');
  });

  it('parses a real title end-to-end through the CLI process', async () => {
    const { stdout } = await execFileAsync('node', [
      scriptPath,
      '--title',
      REAL_TITLES[0] as string,
    ]);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.shape).toBe('precise');
  });
});
