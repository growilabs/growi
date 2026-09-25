/**
 * Check-run dedup and `ci-app-*` aggregation, shared by `check-runs-facts.ts`
 * and `pr-gate-facts.ts` (task 3.9) — the logic that used to live as a `jq`
 * one-liner in `investigate-flaky-test/SKILL.md` 6-A:
 * `group_by(.name) | map(sort_by(.started_at) | last)`.
 *
 * A commit can carry more than one check-run under the same name: once a PR
 * exists, the same job fires under both a `push` event and a `pull_request`
 * event, and a push superseded by a later one leaves a `cancelled` run
 * behind. Only the newest run per name should count. `started_at` is
 * second-resolution, so two runs can land in the same second — the tie-break
 * then falls to the numerically larger `id` (the run GitHub created later).
 *
 * This must behave identically whether a name has exactly one run (the
 * overwhelming common case — an ordinary `master` push) or several: a
 * seedless `reduce`-style comparison would either throw on an empty
 * per-name group or silently do nothing useful for a lone run, hiding a
 * broken comparator until the two-run case showed up.
 */
import { compareIso } from './time.ts';

export type RawCheckRun = {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly started_at: string;
};

/** One page of `GET commits/{sha}/check-runs`'s response shape. */
export type RawCheckRunsPage = {
  readonly check_runs: readonly RawCheckRun[];
};

export type CheckRun = {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly startedAt: string;
};

const toCheckRun = (raw: RawCheckRun): CheckRun => ({
  id: raw.id,
  name: raw.name,
  status: raw.status,
  conclusion: raw.conclusion,
  startedAt: raw.started_at,
});

/** `true` when `candidate` is newer than `current` — later `startedAt` first, then the larger `id` breaks an exact tie. */
const isNewer = (candidate: CheckRun, current: CheckRun): boolean => {
  const byStartedAt = compareIso(candidate.startedAt, current.startedAt);
  if (byStartedAt !== 0) {
    return byStartedAt > 0;
  }
  return candidate.id > current.id;
};

/** Deduplicates check-runs by name, keeping only the newest run for each name. */
export const dedupeNewestByName = (
  rawChecks: readonly RawCheckRun[],
): readonly CheckRun[] => {
  const newestByName = new Map<string, CheckRun>();
  for (const raw of rawChecks) {
    const candidate = toCheckRun(raw);
    const current = newestByName.get(candidate.name);
    if (current == null || isNewer(candidate, current)) {
      newestByName.set(candidate.name, candidate);
    }
  }
  return [...newestByName.values()];
};

const CI_APP_PREFIX = 'ci-app-';

export type CiAppFacts = {
  readonly total: number;
  readonly notSuccess: readonly CheckRun[];
};

/**
 * `checks` must already be deduped (one entry per name) — this does not
 * re-dedupe. `notSuccess` includes a check-run that has not completed yet
 * (its `conclusion` is `null`), not only one that finished with a failing
 * conclusion: the gate this feeds ("every `ci-app-*` check-run concluded
 * `success`") is not met by a still-running one either.
 */
export const aggregateCiApp = (checks: readonly CheckRun[]): CiAppFacts => {
  const ciAppChecks = checks.filter((check) =>
    check.name.startsWith(CI_APP_PREFIX),
  );
  return {
    total: ciAppChecks.length,
    notSuccess: ciAppChecks.filter((check) => check.conclusion !== 'success'),
  };
};
