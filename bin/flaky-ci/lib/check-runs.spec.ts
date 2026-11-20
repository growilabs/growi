import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  aggregateCiApp,
  type CheckRun,
  dedupeNewestByName,
  type RawCheckRun,
} from './check-runs.ts';

const readFixture = (relativePath: string): { check_runs: RawCheckRun[] } =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const REAL_UNIQUE_NAMES = readFixture(
  '../fixtures/api/check-runs/0d1a319a-check-runs.json',
).check_runs;
const REAL_DUPLICATE_NAMES = readFixture(
  '../fixtures/api/check-runs/807c3628-check-runs.json',
).check_runs;
const REAL_CI_APP_FAILURES = readFixture(
  '../fixtures/api/check-runs/235dd237-check-runs.json',
).check_runs;
const CONSTRUCTED_SIMULTANEOUS_TIMESTAMP = readFixture(
  '../fixtures/api/check-runs/constructed-simultaneous-timestamp.json',
).check_runs;

describe('check-runs.dedupeNewestByName', () => {
  it('keeps every check-run unchanged when every name is unique (the common case — one run per name)', () => {
    const deduped = dedupeNewestByName(REAL_UNIQUE_NAMES);
    expect(deduped).toHaveLength(REAL_UNIQUE_NAMES.length);
    expect(deduped.map((check) => check.name).sort()).toEqual(
      REAL_UNIQUE_NAMES.map((check) => check.name).sort(),
    );
  });

  it('keeps only the newest-by-started_at run per name (real: commit 807c3628, push + pull_request events)', () => {
    const deduped = dedupeNewestByName(REAL_DUPLICATE_NAMES);
    const names = deduped.map((check) => check.name);
    expect(new Set(names).size).toBe(names.length);

    const testIntegration93 = deduped.find(
      (check) => check.name === 'ci-app-test-integration (24.x, 8.0, 9, 9.3.3)',
    );
    // The newest run for this name (09:19:17Z, id 104737289243) is
    // `cancelled`, superseding an earlier `success` at 09:17:06Z — proving
    // "newest wins" is not the same thing as "the successful one wins".
    expect(testIntegration93).toEqual<CheckRun>({
      id: 104737289243,
      name: 'ci-app-test-integration (24.x, 8.0, 9, 9.3.3)',
      status: 'completed',
      conclusion: 'cancelled',
      startedAt: '2026-09-16T09:19:17Z',
    });
  });

  it('breaks an exact started_at tie by the larger id, not by input order', () => {
    const deduped = dedupeNewestByName(CONSTRUCTED_SIMULTANEOUS_TIMESTAMP);
    expect(deduped).toEqual<readonly CheckRun[]>([
      {
        id: 100000000002,
        name: 'ci-app-test (24.x, 6.0)',
        status: 'completed',
        conclusion: 'success',
        startedAt: '2026-09-16T09:19:17Z',
      },
    ]);
  });

  it('picks the larger id regardless of which entry appears first in the input', () => {
    const reversed = [...CONSTRUCTED_SIMULTANEOUS_TIMESTAMP].reverse();
    const deduped = dedupeNewestByName(reversed);
    expect(deduped[0]?.id).toBe(100000000002);
  });

  it('returns an empty array for an empty input', () => {
    expect(dedupeNewestByName([])).toEqual([]);
  });
});

describe('check-runs.aggregateCiApp', () => {
  it('reports total and notSuccess from real ci-app-* dedup output (commit 235dd237)', () => {
    const deduped = dedupeNewestByName(REAL_CI_APP_FAILURES);
    const { total, notSuccess } = aggregateCiApp(deduped);

    expect(total).toBe(7);
    expect(notSuccess.map((check) => check.name).sort()).toEqual([
      'ci-app-test (24.x, 6.0)',
      'ci-app-test (24.x, 8.0)',
      'ci-app-test-integration (24.x, 8.0, 8, 8.19.16)',
    ]);
    expect(notSuccess.every((check) => check.conclusion !== 'success')).toBe(
      true,
    );
  });

  it('excludes a check-run whose name does not start with ci-app-', () => {
    const { total } = aggregateCiApp(dedupeNewestByName(REAL_DUPLICATE_NAMES));
    // REAL_DUPLICATE_NAMES also carries "test-prod-node24", "Summary", etc.
    expect(total).toBeLessThan(REAL_DUPLICATE_NAMES.length);
  });

  it('treats an empty ci-app-* set as total 0, not a failure', () => {
    expect(aggregateCiApp([])).toEqual({ total: 0, notSuccess: [] });
  });

  it('counts a still-running check-run (null conclusion) as not-success', () => {
    const pending: CheckRun = {
      id: 1,
      name: 'ci-app-lint (24.x)',
      status: 'in_progress',
      conclusion: null,
      startedAt: '2026-09-16T09:19:17Z',
    };
    expect(aggregateCiApp([pending])).toEqual({
      total: 1,
      notSuccess: [pending],
    });
  });
});
