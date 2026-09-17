#!/usr/bin/env node
/**
 * The material for `detect-flaky-ci/SKILL.md`'s ② (sandwich pattern) and ③
 * (matrix divergence) checks — two of the five mechanical "Cheap Suspicion
 * Mining" signals evaluated for every fresh vitest failure. Both checks only
 * re-read data already fetched elsewhere in the same scan (Step 1's run list
 * for ②, the jobs-list call already made for the failing run's commit for
 * ③), so this script makes no `gh api` call of its own — it is a pure
 * computation over two files the procedure assembles.
 *
 * Usage: node mining-signals.ts --runs-file <path> --identity <path>
 *
 * `--runs-file` is `list-candidate-runs.ts`'s own stdout, saved to a file —
 * the full trailing-window run list for the one workflow this identity's
 * failures come from (`id`, `conclusion`, `headSha`, `createdAt`, `url`,
 * `event`, `attempt`), passed through unchanged.
 *
 * `--identity` is a small JSON file the procedure assembles from data it
 * already has in hand this scan (Step 2's per-run parse-job-log.ts output,
 * and the jobs-list call ③ already names):
 *
 *   {
 *     "specPath": "...", "testTitle": "...",
 *     "targetRun": { "id", "headSha", "createdAt", "url" },
 *     "priorFailingRunIds": [123, ...],
 *     "jobName": "ci-app-test-integration (24.x, 8.0, 8, 8.19.16)",
 *     "siblingJobs": [ { "name": "...", "conclusion": "success" | "failure" | null }, ... ]
 *   }
 *
 * `targetRun` is the run being classified right now ("here" in the evidence
 * strings below); `priorFailingRunIds` are other runs within `--runs-file`'s
 * window where Step 2 already found this same identity failing this scan
 * (② looks only at *fresh* observations from this scan, never at an
 * existing issue's recorded history — that is check ④, a separate
 * mechanism). `siblingJobs` is the raw jobs list for `targetRun`'s commit
 * (`gh api repos/growilabs/growi/actions/runs/{RUN_ID}/jobs`), including
 * `jobName` itself.
 *
 * Output fields (exit 0): `sandwich: { hit, evidence }`,
 * `matrixSplit: { hit, evidence }` — both a boolean and a one-line reason,
 * win or lose, so the procedure's issue-body template always has something
 * to show. `hit: false` is a normal fact, never a failure.
 * Exit 2: --runs-file/--identity missing, or either file could not be read
 * or does not parse into the shape above.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { emit, type ScriptResult } from '../lib/output.ts';
import { compareIso } from '../lib/time.ts';

const HELP = `Usage: node mining-signals.ts --runs-file <path> --identity <path>

Computes detect-flaky-ci's ② sandwich pattern and ③ matrix divergence
signals from data already fetched this scan. Makes no gh api call itself.

--runs-file: list-candidate-runs.ts's saved stdout for the identity's workflow.
--identity: a JSON file with specPath, testTitle, targetRun
  ({id, headSha, createdAt, url}), priorFailingRunIds[], jobName, siblingJobs[]
  ({name, conclusion}).

Output fields (exit 0): sandwich { hit, evidence }, matrixSplit { hit, evidence }.
Exit code 2: a required argument is missing, or a file could not be read or
does not parse into the expected shape.
`;

export type CliArgs = {
  readonly runsFile: string;
  readonly identityFile: string;
};

export type ParsedArgv =
  | { readonly kind: 'help' }
  | { readonly kind: 'args'; readonly value: CliArgs }
  | { readonly kind: 'invalid'; readonly reason: string };

const flagValue = (
  argv: readonly string[],
  name: string,
): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

export const parseArgv = (argv: readonly string[]): ParsedArgv => {
  if (argv.includes('--help')) {
    return { kind: 'help' };
  }
  const runsFile = flagValue(argv, 'runs-file');
  const identityFile = flagValue(argv, 'identity');
  if (runsFile == null || identityFile == null) {
    return {
      kind: 'invalid',
      reason: '--runs-file and --identity are both required',
    };
  }
  return { kind: 'args', value: { runsFile, identityFile } };
};

export type Run = {
  readonly id: number;
  readonly conclusion: string | null;
  readonly headSha: string;
  readonly createdAt: string;
  readonly url: string;
  readonly event: string;
  readonly attempt: number;
};

export type TargetRun = {
  readonly id: number;
  readonly headSha: string;
  readonly createdAt: string;
  readonly url: string;
};

export type SiblingJob = {
  readonly name: string;
  readonly conclusion: string | null;
};

export type IdentityInput = {
  readonly specPath: string;
  readonly testTitle: string;
  readonly targetRun: TargetRun;
  readonly priorFailingRunIds: readonly number[];
  readonly jobName: string;
  readonly siblingJobs: readonly SiblingJob[];
};

export type MiningSignal = {
  readonly hit: boolean;
  readonly evidence: string;
};

/** `is` guards so a malformed file fails as a precondition, not a crash. */
const isRun = (value: unknown): value is Run =>
  typeof value === 'object' &&
  value != null &&
  typeof (value as Run).id === 'number' &&
  typeof (value as Run).createdAt === 'string' &&
  typeof (value as Run).url === 'string' &&
  ('conclusion' in value === false ||
    typeof (value as Run).conclusion === 'string' ||
    (value as Run).conclusion === null);

const parseRunsFile = (raw: unknown): readonly Run[] | null => {
  if (typeof raw !== 'object' || raw == null) {
    return null;
  }
  const { runs } = raw as { runs?: unknown };
  if (!Array.isArray(runs) || !runs.every(isRun)) {
    return null;
  }
  return runs;
};

const isTargetRun = (value: unknown): value is TargetRun =>
  typeof value === 'object' &&
  value != null &&
  typeof (value as TargetRun).id === 'number' &&
  typeof (value as TargetRun).headSha === 'string' &&
  typeof (value as TargetRun).createdAt === 'string' &&
  typeof (value as TargetRun).url === 'string';

const isSiblingJob = (value: unknown): value is SiblingJob =>
  typeof value === 'object' &&
  value != null &&
  typeof (value as SiblingJob).name === 'string' &&
  ((value as SiblingJob).conclusion === null ||
    typeof (value as SiblingJob).conclusion === 'string');

const parseIdentityFile = (raw: unknown): IdentityInput | null => {
  if (typeof raw !== 'object' || raw == null) {
    return null;
  }
  const input = raw as Partial<IdentityInput>;
  if (
    typeof input.specPath !== 'string' ||
    typeof input.testTitle !== 'string' ||
    !isTargetRun(input.targetRun) ||
    !Array.isArray(input.priorFailingRunIds) ||
    !input.priorFailingRunIds.every((id) => typeof id === 'number') ||
    typeof input.jobName !== 'string' ||
    !Array.isArray(input.siblingJobs) ||
    !input.siblingJobs.every(isSiblingJob)
  ) {
    return null;
  }
  return {
    specPath: input.specPath,
    testTitle: input.testTitle,
    targetRun: input.targetRun,
    priorFailingRunIds: input.priorFailingRunIds,
    jobName: input.jobName,
    siblingJobs: input.siblingJobs,
  };
};

const NO_PRIOR_OCCURRENCE_EVIDENCE =
  'only one occurrence of this identity was observed in the window, nothing to sandwich against';
const NO_INTERVENING_SUCCESS_EVIDENCE =
  'no successful run of the same workflow was found between a prior occurrence and this run';

/**
 * ② Sandwich pattern: this same identity failed in an earlier run within the
 * window, a run of the same workflow in between succeeded, and it failed
 * again in `targetRun` ("here"). `runs` is intentionally re-sorted by
 * `createdAt` rather than trusted to arrive in any particular order —
 * `list-candidate-runs.ts` documents newest-first, but nothing here depends
 * on that holding.
 *
 * Only `priorFailingRunIds` older than `targetRun` count as "a prior
 * occurrence" (a later one would not have been observed yet when
 * `targetRun` failed). Guards against the single-item-vs-N-items class of
 * bug: zero prior occurrences is handled as its own branch before any
 * comparison runs, so a one-element `priorFailingRunIds` never reaches a
 * short-circuiting `reduce`/`find` that silently returns `undefined` as if
 * it had considered and rejected it.
 */
export const evaluateSandwich = (
  runs: readonly Run[],
  targetRun: TargetRun,
  priorFailingRunIds: readonly number[],
): MiningSignal => {
  if (priorFailingRunIds.length === 0) {
    return { hit: false, evidence: NO_PRIOR_OCCURRENCE_EVIDENCE };
  }

  const runById = new Map(runs.map((candidate) => [candidate.id, candidate]));

  const priorRuns = priorFailingRunIds
    .map((id) => runById.get(id))
    .filter((candidate): candidate is Run => candidate != null)
    .filter(
      (candidate) => compareIso(candidate.createdAt, targetRun.createdAt) < 0,
    )
    // Nearest to targetRun first: the closest prior occurrence is the
    // strongest, most literal sandwich; farther ones are only tried if the
    // nearest one has no intervening success.
    .sort((a, b) => compareIso(b.createdAt, a.createdAt));

  if (priorRuns.length === 0) {
    return { hit: false, evidence: NO_PRIOR_OCCURRENCE_EVIDENCE };
  }

  for (const priorRun of priorRuns) {
    const interveningSuccess = runs.find(
      (candidate) =>
        candidate.conclusion === 'success' &&
        compareIso(candidate.createdAt, priorRun.createdAt) > 0 &&
        compareIso(candidate.createdAt, targetRun.createdAt) < 0,
    );
    if (interveningSuccess != null) {
      return {
        hit: true,
        evidence: `same identity failed in run ${priorRun.url}, passed in intervening run ${interveningSuccess.url}, failed again here`,
      };
    }
  }

  return { hit: false, evidence: NO_INTERVENING_SUCCESS_EVIDENCE };
};

/** The job name without its trailing matrix-cell parameter list, e.g.
 * `ci-app-test-integration (24.x, 8.0, 8, 8.19.16)` → `ci-app-test-integration`.
 * A job name with no `(...)` suffix is returned unchanged. */
const jobBaseName = (name: string): string => name.split(' (')[0].trim();

const NO_MATRIX_SPLIT_EVIDENCE =
  'no sibling matrix job on the same commit passed';

/**
 * ③ Matrix divergence: another matrix cell of the *same job* (same base
 * name before the `(...)` parameters) on the same commit passed while
 * `jobName` failed.
 */
export const evaluateMatrixSplit = (
  jobName: string,
  siblingJobs: readonly SiblingJob[],
): MiningSignal => {
  const baseName = jobBaseName(jobName);
  const passingSibling = siblingJobs.find(
    (job) =>
      job.name !== jobName &&
      jobBaseName(job.name) === baseName &&
      job.conclusion === 'success',
  );
  if (passingSibling != null) {
    return {
      hit: true,
      evidence: `sibling matrix job ${passingSibling.name} on the same commit passed`,
    };
  }
  return { hit: false, evidence: NO_MATRIX_SPLIT_EVIDENCE };
};

export const run = (
  readFile: (path: string) => string,
  args: CliArgs,
): ScriptResult => {
  let runsRaw: unknown;
  try {
    runsRaw = JSON.parse(readFile(args.runsFile));
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: `could not read or parse --runs-file ${args.runsFile}: ${(error as Error).message}`,
      },
    };
  }
  const runs = parseRunsFile(runsRaw);
  if (runs == null) {
    return {
      ok: false,
      failure: {
        reason: `--runs-file ${args.runsFile} does not have the expected { runs: [...] } shape`,
      },
    };
  }

  let identityRaw: unknown;
  try {
    identityRaw = JSON.parse(readFile(args.identityFile));
  } catch (error) {
    return {
      ok: false,
      failure: {
        reason: `could not read or parse --identity ${args.identityFile}: ${(error as Error).message}`,
      },
    };
  }
  const identity = parseIdentityFile(identityRaw);
  if (identity == null) {
    return {
      ok: false,
      failure: {
        reason: `--identity ${args.identityFile} does not have the expected shape (specPath, testTitle, targetRun, priorFailingRunIds, jobName, siblingJobs)`,
      },
    };
  }

  const sandwich = evaluateSandwich(
    runs,
    identity.targetRun,
    identity.priorFailingRunIds,
  );
  const matrixSplit = evaluateMatrixSplit(
    identity.jobName,
    identity.siblingJobs,
  );

  return { ok: true, facts: { sandwich, matrixSplit } };
};

const isMainModule = (): boolean => {
  const entry = process.argv[1];
  if (entry == null) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
};

if (isMainModule()) {
  const parsed = parseArgv(process.argv.slice(2));
  if (parsed.kind === 'help') {
    process.stdout.write(HELP);
    process.exit(0);
  } else if (parsed.kind === 'invalid') {
    emit({ ok: false, failure: { reason: parsed.reason } });
  } else {
    emit(run((path) => readFileSync(path, 'utf8'), parsed.value));
  }
}
