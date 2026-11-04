import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { format, UNAVAILABLE } from './output.ts';

const execFileAsync = promisify(execFile);

const fixtureCli = fileURLToPath(
  new URL('./__fixtures__/emit-cli.ts', import.meta.url),
);

type CliRun = {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
};

const runFixtureCli = async (mode: string): Promise<CliRun> => {
  try {
    const { stdout, stderr } = await execFileAsync('node', [fixtureCli, mode]);
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      code: failure.code ?? -1,
    };
  }
};

describe('output.format — success', () => {
  it('writes the facts as one line of JSON with ok:true and exit code 0', () => {
    const parts = format({ ok: true, facts: { runs: 20, failed: 3 } });
    expect(parts.exitCode).toBe(0);
    expect(parts.stderr).toBe('');
    expect(parts.stdout).toBe('{"ok":true,"runs":20,"failed":3}\n');
    expect(parts.stdout.trimEnd().split('\n')).toHaveLength(1);
  });

  it('treats "zero rows" as a normal success, not a failure', () => {
    const parts = format({ ok: true, facts: { issues: [] } });
    expect(parts.exitCode).toBe(0);
    expect(JSON.parse(parts.stdout)).toEqual({ ok: true, issues: [] });
  });

  it('keeps a row-level unreadable value as a field while the whole result stays ok', () => {
    // The multi-row convention: one row that could not be read is a fact on
    // that row, not a failure of the whole script.
    const parts = format({
      ok: true,
      facts: {
        rows: [
          { issue: 1, pausedAt: '2026-09-14T12:12:24Z', pausedAtStatus: 'ok' },
          { issue: 2, pausedAt: null, pausedAtStatus: UNAVAILABLE },
        ],
      },
    });
    expect(parts.exitCode).toBe(0);
    expect(JSON.parse(parts.stdout)).toEqual({
      ok: true,
      rows: [
        { issue: 1, pausedAt: '2026-09-14T12:12:24Z', pausedAtStatus: 'ok' },
        { issue: 2, pausedAt: null, pausedAtStatus: 'unavailable' },
      ],
    });
  });

  it('refuses facts that would collide with the ok field', () => {
    expect(() => format({ ok: true, facts: { ok: false } })).toThrow();
  });

  it('refuses facts that cannot be turned into JSON', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => format({ ok: true, facts: circular })).toThrow();
  });
});

describe('output.format — failure', () => {
  it('writes nothing to stdout, one line of reason to stderr, and exits 2', () => {
    const parts = format({
      ok: false,
      failure: { reason: 'no repro result comment for 0b1d2c3' },
    });
    expect(parts.exitCode).toBe(2);
    expect(parts.stdout).toBe('');
    expect(parts.stderr).toBe('no repro result comment for 0b1d2c3\n');
  });

  it('collapses a multi-line reason into a single line', () => {
    const parts = format({
      ok: false,
      failure: { reason: 'gh api failed\n  exit status 1\n' },
    });
    expect(parts.stderr.trimEnd().split('\n')).toHaveLength(1);
    expect(parts.stderr).toBe('gh api failed exit status 1\n');
  });

  it('refuses an empty reason', () => {
    expect(() => format({ ok: false, failure: { reason: '   ' } })).toThrow();
  });
});

describe('output.emit — real process behaviour', () => {
  it('exits 0 with the JSON on stdout for a success', async () => {
    const run = await runFixtureCli('success');
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, runs: 20, failed: 3 });
    expect(run.stderr).toBe('');
  });

  it('exits 2 with an empty stdout for a failure', async () => {
    const run = await runFixtureCli('failure');
    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('cannot read the issue body\n');
  });
});
