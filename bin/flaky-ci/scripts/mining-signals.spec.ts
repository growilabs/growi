import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  evaluateMatrixSplit,
  evaluateSandwich,
  parseArgv,
  type Run,
  run,
  type SiblingJob,
  type TargetRun,
} from './mining-signals.ts';

const execFileAsync = promisify(execFile);

const scriptPath = fileURLToPath(
  new URL('./mining-signals.ts', import.meta.url),
);

const makeRun = (
  overrides: Partial<Run> & { id: number; createdAt: string },
): Run => ({
  id: overrides.id,
  conclusion: overrides.conclusion ?? 'failure',
  headSha: overrides.headSha ?? `sha-${overrides.id}`,
  createdAt: overrides.createdAt,
  url:
    overrides.url ??
    `https://github.com/growilabs/growi/actions/runs/${overrides.id}`,
  event: overrides.event ?? 'push',
  attempt: overrides.attempt ?? 1,
});

const TARGET: TargetRun = {
  id: 300,
  headSha: 'target-sha',
  createdAt: '2026-09-16T03:00:00Z',
  url: 'https://github.com/growilabs/growi/actions/runs/300',
};

describe('evaluateSandwich', () => {
  it('misses when there is no prior occurrence of this identity in the window', () => {
    const runs: Run[] = [
      makeRun({
        id: 100,
        createdAt: '2026-09-16T01:00:00Z',
        conclusion: 'success',
      }),
      makeRun({ id: 300, createdAt: TARGET.createdAt, conclusion: 'failure' }),
    ];

    const result = evaluateSandwich(runs, TARGET, []);

    expect(result).toEqual({
      hit: false,
      evidence:
        'only one occurrence of this identity was observed in the window, nothing to sandwich against',
    });
  });

  it('hits when an earlier occurrence is separated from the target by a passing run of the same workflow', () => {
    const priorOccurrence = makeRun({
      id: 100,
      createdAt: '2026-09-16T01:00:00Z',
      conclusion: 'failure',
    });
    const interveningPass = makeRun({
      id: 200,
      createdAt: '2026-09-16T02:00:00Z',
      conclusion: 'success',
    });
    const runs: Run[] = [priorOccurrence, interveningPass, makeRun(TARGET)];

    const result = evaluateSandwich(runs, TARGET, [100]);

    expect(result).toEqual({
      hit: true,
      evidence: `same identity failed in run ${priorOccurrence.url}, passed in intervening run ${interveningPass.url}, failed again here`,
    });
  });

  it('misses when a prior occurrence exists but nothing in between it and the target succeeded', () => {
    const priorOccurrence = makeRun({
      id: 100,
      createdAt: '2026-09-16T01:00:00Z',
      conclusion: 'failure',
    });
    const interveningFailure = makeRun({
      id: 200,
      createdAt: '2026-09-16T02:00:00Z',
      conclusion: 'failure',
    });
    const runs: Run[] = [priorOccurrence, interveningFailure, makeRun(TARGET)];

    const result = evaluateSandwich(runs, TARGET, [100]);

    expect(result).toEqual({
      hit: false,
      evidence:
        'no successful run of the same workflow was found between a prior occurrence and this run',
    });
  });

  it('does not short-circuit on a single-element priorFailingRunIds array (the reduce/find single-item bug class)', () => {
    // Regression for the class of bug recorded in tasks.md task 2.2/2.3:
    // a single-candidate array must still be evaluated, not assumed absent
    // or assumed matching without checking the intervening run.
    const onlyPriorOccurrence = makeRun({
      id: 100,
      createdAt: '2026-09-16T01:00:00Z',
      conclusion: 'failure',
    });
    const runsWithNoIntervening: Run[] = [onlyPriorOccurrence, makeRun(TARGET)];

    expect(evaluateSandwich(runsWithNoIntervening, TARGET, [100])).toEqual({
      hit: false,
      evidence:
        'no successful run of the same workflow was found between a prior occurrence and this run',
    });

    const interveningPass = makeRun({
      id: 150,
      createdAt: '2026-09-16T01:30:00Z',
      conclusion: 'success',
    });
    const runsWithIntervening: Run[] = [
      onlyPriorOccurrence,
      interveningPass,
      makeRun(TARGET),
    ];

    expect(evaluateSandwich(runsWithIntervening, TARGET, [100])).toEqual({
      hit: true,
      evidence: `same identity failed in run ${onlyPriorOccurrence.url}, passed in intervening run ${interveningPass.url}, failed again here`,
    });
  });

  it('ignores a "prior" occurrence id that is actually newer than the target run', () => {
    const runsFile: Run[] = [
      makeRun(TARGET),
      makeRun({
        id: 400,
        createdAt: '2026-09-16T04:00:00Z',
        conclusion: 'failure',
      }),
    ];

    const result = evaluateSandwich(runsFile, TARGET, [400]);

    expect(result).toEqual({
      hit: false,
      evidence:
        'only one occurrence of this identity was observed in the window, nothing to sandwich against',
    });
  });

  it('is order-independent — runs.file order does not affect the result', () => {
    const priorOccurrence = makeRun({
      id: 100,
      createdAt: '2026-09-16T01:00:00Z',
      conclusion: 'failure',
    });
    const interveningPass = makeRun({
      id: 200,
      createdAt: '2026-09-16T02:00:00Z',
      conclusion: 'success',
    });
    // Oldest-first, the opposite of list-candidate-runs.ts's newest-first order.
    const runs: Run[] = [makeRun(TARGET), interveningPass, priorOccurrence];

    const result = evaluateSandwich(runs, TARGET, [100]);

    expect(result.hit).toBe(true);
  });
});

describe('evaluateMatrixSplit', () => {
  const JOB_NAME = 'ci-app-test-integration (24.x, 8.0, 8, 8.19.16)';

  it('misses when there are no sibling matrix jobs', () => {
    const result = evaluateMatrixSplit(JOB_NAME, [
      { name: JOB_NAME, conclusion: 'failure' },
    ]);

    expect(result).toEqual({
      hit: false,
      evidence: 'no sibling matrix job on the same commit passed',
    });
  });

  it('hits when a sibling matrix cell of the same job passed', () => {
    const sibling: SiblingJob = {
      name: 'ci-app-test-integration (22.x, 7.0, 6, 8.19.16)',
      conclusion: 'success',
    };
    const result = evaluateMatrixSplit(JOB_NAME, [
      { name: JOB_NAME, conclusion: 'failure' },
      sibling,
    ]);

    expect(result).toEqual({
      hit: true,
      evidence: `sibling matrix job ${sibling.name} on the same commit passed`,
    });
  });

  it('does not match a passing job of a different job entirely, only same-base-name matrix cells', () => {
    const result = evaluateMatrixSplit(JOB_NAME, [
      { name: JOB_NAME, conclusion: 'failure' },
      { name: 'ci-app-test', conclusion: 'success' },
      { name: 'run-playwright', conclusion: 'success' },
    ]);

    expect(result).toEqual({
      hit: false,
      evidence: 'no sibling matrix job on the same commit passed',
    });
  });

  it('misses when every sibling matrix cell also failed', () => {
    const result = evaluateMatrixSplit(JOB_NAME, [
      { name: JOB_NAME, conclusion: 'failure' },
      {
        name: 'ci-app-test-integration (22.x, 7.0, 6, 8.19.16)',
        conclusion: 'failure',
      },
    ]);

    expect(result).toEqual({
      hit: false,
      evidence: 'no sibling matrix job on the same commit passed',
    });
  });

  it('handles a job name with no matrix parameter suffix', () => {
    const result = evaluateMatrixSplit('ci-app-test', [
      { name: 'ci-app-test', conclusion: 'failure' },
    ]);

    expect(result).toEqual({
      hit: false,
      evidence: 'no sibling matrix job on the same commit passed',
    });
  });
});

describe('run (CLI wiring)', () => {
  const fakeReadFile =
    (files: Record<string, unknown>) =>
    (path: string): string => {
      if (!(path in files)) {
        throw new Error(`ENOENT: no such file, open '${path}'`);
      }
      return JSON.stringify(files[path]);
    };

  it('combines both signals from --runs-file and --identity into one result', () => {
    const files = {
      'runs.json': {
        runs: [
          makeRun({
            id: 100,
            createdAt: '2026-09-16T01:00:00Z',
            conclusion: 'failure',
          }),
          makeRun({
            id: 200,
            createdAt: '2026-09-16T02:00:00Z',
            conclusion: 'success',
          }),
          makeRun(TARGET),
        ],
      },
      'identity.json': {
        specPath: 'apps/app/src/foo.integ.ts',
        testTitle: 'does the thing',
        targetRun: TARGET,
        priorFailingRunIds: [100],
        jobName: 'ci-app-test-integration (24.x, 8.0, 8, 8.19.16)',
        siblingJobs: [
          {
            name: 'ci-app-test-integration (24.x, 8.0, 8, 8.19.16)',
            conclusion: 'failure',
          },
          {
            name: 'ci-app-test-integration (22.x, 7.0, 6, 8.19.16)',
            conclusion: 'success',
          },
        ],
      },
    };

    const result = run(fakeReadFile(files), {
      runsFile: 'runs.json',
      identityFile: 'identity.json',
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      facts: {
        sandwich: { hit: true },
        matrixSplit: { hit: true },
      },
    });
  });

  it('exits with a failure when --runs-file cannot be read', () => {
    const result = run(fakeReadFile({}), {
      runsFile: 'missing-runs.json',
      identityFile: 'identity.json',
    });

    expect(result.ok).toBe(false);
  });

  it('exits with a failure when --identity does not parse into the expected shape', () => {
    const files = {
      'runs.json': { runs: [] },
      'identity.json': { not: 'the right shape' },
    };

    const result = run(fakeReadFile(files), {
      runsFile: 'runs.json',
      identityFile: 'identity.json',
    });

    expect(result.ok).toBe(false);
  });

  it('exits with a failure when --runs-file does not have the { runs: [...] } shape', () => {
    const files = {
      'runs.json': { notRuns: [] },
      'identity.json': {
        specPath: 'x',
        testTitle: 'y',
        targetRun: TARGET,
        priorFailingRunIds: [],
        jobName: 'ci-app-test',
        siblingJobs: [],
      },
    };

    const result = run(fakeReadFile(files), {
      runsFile: 'runs.json',
      identityFile: 'identity.json',
    });

    expect(result.ok).toBe(false);
  });
});

describe('parseArgv', () => {
  it('requires both --runs-file and --identity', () => {
    expect(parseArgv([])).toEqual({
      kind: 'invalid',
      reason: '--runs-file and --identity are both required',
    });
    expect(parseArgv(['--runs-file', 'a.json'])).toEqual({
      kind: 'invalid',
      reason: '--runs-file and --identity are both required',
    });
  });

  it('parses both flags', () => {
    expect(
      parseArgv(['--runs-file', 'a.json', '--identity', 'b.json']),
    ).toEqual({
      kind: 'args',
      value: { runsFile: 'a.json', identityFile: 'b.json' },
    });
  });

  it('treats --help as its own outcome even alongside other flags', () => {
    expect(parseArgv(['--runs-file', 'a.json', '--help'])).toEqual({
      kind: 'help',
    });
  });
});

describe('CLI process', () => {
  it('exits 0 on --help without reading any file', async () => {
    const { stdout } = await execFileAsync('node', [scriptPath, '--help']);
    expect(stdout).toContain('Usage: node mining-signals.ts');
  });

  it('exits 2 when required flags are missing', async () => {
    const result = await execFileAsync('node', [scriptPath]).catch(
      (error) => error,
    );
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(
      '--runs-file and --identity are both required',
    );
  });
});
