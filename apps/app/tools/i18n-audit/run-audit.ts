/**
 * Audit Orchestrator (design.md: Components and Interfaces > Tooling > Audit
 * Orchestrator). Runs the three read-only `i18next-cli status` forms,
 * interprets their stdout via the Stdout Parser, and judges pass/fail via
 * the Baseline Store.
 *
 * This file is the ONLY place in this feature allowed to invoke
 * `i18next-cli` (Requirement 5: translation-file immutability) — it must
 * never call `extract` or `sync`, only the read-only `status` form.
 *
 * Two execution modes, selected by `process.argv`:
 * - Normal (no flags): reads `baseline.json` with `readBaselineFile`, which
 *   hard-fails if the file is missing or corrupt (Error Handling: no silent
 *   fallback). Compares measurements against it and sets the process exit
 *   code accordingly.
 * - `--update-baseline` (optionally with `--allow-regression`): reads the
 *   baseline with `tryReadBaselineFile` (null-safe first-run case), computes
 *   the update via `computeBaselineUpdate`, prints the before -> after delta
 *   to stdout (design.md Baseline Store: this must always be visible in the
 *   run log, not just in the file diff), and writes the new baseline file —
 *   unless `computeBaselineUpdate` throws `BaselineRegressionError`, in which
 *   case nothing is written.
 *
 * Per coding-style.md's Pure Function Extraction: the actual pass/fail
 * decision (`decideAudit`) and the update-mode decision (`decideBaselineUpdate`)
 * are pure functions over already-captured measurements and a baseline
 * object, so both are unit-testable without spawning any process or
 * touching the real baseline.json. `runCliCommand` / `measureCheck` /
 * `runNormalMode` / `runUpdateBaselineMode` are the thin, I/O-touching
 * wrappers around them.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import i18nextConfig from '../../i18next.config.ts';
import {
  type BaselineEvaluationResult,
  BaselineRegressionError,
  computeBaselineUpdate,
  evaluateAgainstBaseline,
  type I18nAuditBaseline,
  type LocaleMissingCounts,
  readBaselineFile,
  tryReadBaselineFile,
  writeBaselineFile,
} from './baseline.ts';
import {
  parseDefaultLanguageMissingCount,
  parseLocaleMissingCount,
  parseUnusedCount,
} from './parse-status-output.ts';

const CLI_ENTRY = fileURLToPath(
  new URL('../../node_modules/i18next-cli/dist/esm/cli.js', import.meta.url),
);
const BASELINE_PATH = fileURLToPath(
  new URL('./baseline.json', import.meta.url),
);

// Single source of truth for which locales get a per-locale drift check:
// every configured locale other than the primary one. Reading this from
// i18next.config.ts (rather than duplicating the list here) means a future
// locale addition/removal only has to touch that one file.
const SECONDARY_LOCALES: readonly string[] =
  i18nextConfig.extract.secondaryLanguages ?? [];

/** The outcome of measuring a single `status` form. */
export type CheckResult =
  | { readonly status: 'ok'; readonly value: number }
  | { readonly status: 'error'; readonly message: string };

export interface AuditMeasurements {
  readonly defaultLanguageMissing: CheckResult;
  readonly unusedKeys: CheckResult;
  readonly missingByLocale: Readonly<Record<string, CheckResult>>;
}

export interface AuditDecision {
  readonly pass: boolean;
  readonly exitCode: number;
  readonly lines: readonly string[];
}

/**
 * Pure decision function: given already-measured counts and a baseline,
 * decides pass/fail per Requirement 1 (default-language missing must be
 * exactly 0 — NOT baseline-tracked, unlike the other two metrics) and
 * Requirement 2/3 (unused-key count and each locale's missing count must be
 * <= their recorded baseline). A measurement that errored (parse failure or
 * command-execution failure) is always treated as a failure, never as a
 * pass — per design.md's Error Handling.
 */
export const decideAudit = (
  measurements: AuditMeasurements,
  baseline: I18nAuditBaseline,
): AuditDecision => {
  const okLines: string[] = [];
  const failureLines: string[] = [];

  const { defaultLanguageMissing, unusedKeys, missingByLocale } = measurements;

  if (defaultLanguageMissing.status === 'error') {
    failureLines.push(
      `FAIL default-language missing-key check errored: ${defaultLanguageMissing.message}`,
    );
  } else if (defaultLanguageMissing.value !== 0) {
    failureLines.push(
      `FAIL default-language missing-key count is ${defaultLanguageMissing.value}, must be 0 (Requirement 1)`,
    );
  } else {
    okLines.push('OK default-language missing-key count is 0');
  }

  // Only feed successfully-measured numbers into the baseline comparison;
  // an errored check is reported as a failure directly and excluded here so
  // it can never be silently treated as passing against the baseline.
  let measuredUnusedKeys: number | undefined;
  if (unusedKeys.status === 'error') {
    failureLines.push(`FAIL unused-key check errored: ${unusedKeys.message}`);
  } else {
    measuredUnusedKeys = unusedKeys.value;
  }

  const measuredMissingByLocale: LocaleMissingCounts = {};
  for (const [locale, result] of Object.entries(missingByLocale)) {
    if (result.status === 'error') {
      failureLines.push(
        `FAIL ${locale} missing-key check errored: ${result.message}`,
      );
    } else {
      measuredMissingByLocale[locale] = result.value;
    }
  }

  if (measuredUnusedKeys !== undefined) {
    const evaluation: BaselineEvaluationResult = evaluateAgainstBaseline(
      {
        unusedKeys: measuredUnusedKeys,
        missingByLocale: measuredMissingByLocale,
      },
      baseline,
    );

    if (evaluation.unusedKeys.pass) {
      okLines.push(
        `OK unused-key count ${evaluation.unusedKeys.measured} <= baseline ${evaluation.unusedKeys.baseline}`,
      );
    } else {
      failureLines.push(
        `FAIL unused-key count ${evaluation.unusedKeys.measured} exceeds baseline ${evaluation.unusedKeys.baseline} (Requirement 2)`,
      );
    }

    for (const [locale, localeEvaluation] of Object.entries(
      evaluation.missingByLocale,
    )) {
      if (localeEvaluation.pass) {
        okLines.push(
          `OK ${locale} missing-key count ${localeEvaluation.measured} <= baseline ${localeEvaluation.baseline}`,
        );
      } else {
        failureLines.push(
          `FAIL ${locale} missing-key count ${localeEvaluation.measured} exceeds baseline ${localeEvaluation.baseline} (Requirement 3)`,
        );
      }
    }
  }

  const pass = failureLines.length === 0;
  return { pass, exitCode: pass ? 0 : 1, lines: [...okLines, ...failureLines] };
};

/**
 * Pure decision function for `--update-baseline` mode: given the same
 * measurement shape as `decideAudit` and the existing baseline (`null` on
 * first run), decides what should be printed, what (if anything) should be
 * written, and the exit code. Kept separate from actual console/file I/O so
 * that "the before -> after delta is printed to stdout" (design.md Baseline
 * Store — flagged by task 1.4's reviewer as not yet satisfied by any code)
 * is verifiable directly on the returned `consoleLines`, without needing to
 * spy on `console.log` or touch the real `baseline.json`.
 */
export interface UpdateOutcome {
  readonly consoleLines: readonly string[];
  readonly errorLines: readonly string[];
  readonly writeBaseline: I18nAuditBaseline | null;
  readonly exitCode: number;
}

export const decideBaselineUpdate = (
  measurements: AuditMeasurements,
  existing: I18nAuditBaseline | null,
  options: { allowRegression: boolean },
): UpdateOutcome => {
  const erroredChecks = [
    measurements.defaultLanguageMissing,
    measurements.unusedKeys,
    ...Object.values(measurements.missingByLocale),
  ].filter(
    (result): result is Extract<CheckResult, { status: 'error' }> =>
      result.status === 'error',
  );
  if (erroredChecks.length > 0) {
    return {
      consoleLines: [],
      errorLines: [
        ...erroredChecks.map((errored) => `FAIL ${errored.message}`),
        'Aborting baseline update: measurement failed, baseline.json not written.',
      ],
      writeBaseline: null,
      exitCode: 1,
    };
  }

  const measuredMissingByLocale: LocaleMissingCounts = {};
  for (const [locale, result] of Object.entries(measurements.missingByLocale)) {
    // Safe: erroredChecks above already returned when any check was 'error'.
    measuredMissingByLocale[locale] = (
      result as { status: 'ok'; value: number }
    ).value;
  }
  const measuredUnusedKeys = (
    measurements.unusedKeys as { status: 'ok'; value: number }
  ).value;

  try {
    const { baseline, changes } = computeBaselineUpdate(
      {
        unusedKeys: measuredUnusedKeys,
        missingByLocale: measuredMissingByLocale,
      },
      existing,
      options,
    );

    // design.md Baseline Store: always surface the before -> after delta on
    // stdout, even when nothing changed, so a reviewer can confirm from the
    // run log alone (not just the file diff) what this update did.
    const consoleLines =
      changes.length === 0
        ? ['Baseline update: no changes.']
        : [
            'Baseline update:',
            ...changes.map(
              (change) =>
                `  ${change.metric}: ${change.before} -> ${change.after}`,
            ),
          ];

    return {
      consoleLines,
      errorLines: [],
      writeBaseline: baseline,
      exitCode: 0,
    };
  } catch (error) {
    if (error instanceof BaselineRegressionError) {
      return {
        consoleLines: [],
        errorLines: [error.message],
        writeBaseline: null,
        exitCode: 1,
      };
    }
    throw error;
  }
};

/**
 * Runs one `i18next-cli status` form and returns its raw stdout.
 *
 * `i18next-cli status` exits non-zero when it reports any issue (missing or
 * incomplete keys) — that is expected, not a failure of this wrapper, so the
 * stdout captured on a thrown error is still the data we need. Only when no
 * stdout was captured at all (a genuine execution failure — CLI not found,
 * killed, etc.) is this treated as an error.
 */
const runCliCommand = (args: readonly string[]): string => {
  try {
    return execFileSync('node', [CLI_ENTRY, ...args], {
      encoding: 'utf-8',
    });
  } catch (error) {
    const execError = error as { stdout?: string; message: string };
    if (typeof execError.stdout === 'string' && execError.stdout.length > 0) {
      return execError.stdout;
    }
    throw new Error(
      `i18next-cli ${args.join(' ')} failed to run: ${execError.message}`,
    );
  }
};

/** Runs `run` and converts a thrown error into a {@link CheckResult} error, per Error Handling: a parse or execution failure is always "fail", never treated as 0/pass. */
const measureCheck = (label: string, run: () => number): CheckResult => {
  try {
    return { status: 'ok', value: run() };
  } catch (error) {
    return {
      status: 'error',
      message: `${label}: ${(error as Error).message}`,
    };
  }
};

const measureAll = (): AuditMeasurements => {
  const defaultLanguageMissing = measureCheck('status', () =>
    parseDefaultLanguageMissingCount(runCliCommand(['status'])),
  );
  const unusedKeys = measureCheck('status --unused', () =>
    parseUnusedCount(runCliCommand(['status', '--unused'])),
  );

  const missingByLocale: Record<string, CheckResult> = {};
  for (const locale of SECONDARY_LOCALES) {
    missingByLocale[locale] = measureCheck(`status ${locale}`, () =>
      parseLocaleMissingCount(runCliCommand(['status', locale]), locale),
    );
  }

  return { defaultLanguageMissing, unusedKeys, missingByLocale };
};

/** Exported for tests: runs a full normal-mode pass against `baselinePath`. */
export const runNormalMode = (baselinePath: string): void => {
  let baseline: I18nAuditBaseline;
  try {
    baseline = readBaselineFile(baselinePath);
  } catch (error) {
    // biome-ignore lint/suspicious/noConsole: this is a lint/CI script, console output is expected.
    console.error(
      `Cannot run lint:i18n: ${(error as Error).message}. ` +
        'Run "pnpm run i18n:baseline:update" once to create baseline.json.',
    );
    process.exitCode = 1;
    return;
  }

  const measurements = measureAll();
  const decision = decideAudit(measurements, baseline);
  for (const line of decision.lines) {
    // biome-ignore lint/suspicious/noConsole: this is a lint/CI script, console output is expected.
    console.log(line);
  }
  process.exitCode = decision.exitCode;
};

/**
 * Exported for tests: runs a full `--update-baseline` pass against
 * `baselinePath`, including the real console/file I/O side effects
 * (delegating the decision itself to `decideBaselineUpdate`).
 */
export const runUpdateBaselineMode = (
  allowRegression: boolean,
  baselinePath: string,
): void => {
  const measurements = measureAll();
  const existing = tryReadBaselineFile(baselinePath);
  const outcome = decideBaselineUpdate(measurements, existing, {
    allowRegression,
  });

  for (const line of outcome.consoleLines) {
    // biome-ignore lint/suspicious/noConsole: this is a lint/CI script, console output is expected.
    console.log(line);
  }
  for (const line of outcome.errorLines) {
    // biome-ignore lint/suspicious/noConsole: this is a lint/CI script, console output is expected.
    console.error(line);
  }
  if (outcome.writeBaseline != null) {
    writeBaselineFile(baselinePath, outcome.writeBaseline);
    // biome-ignore lint/suspicious/noConsole: this is a lint/CI script, console output is expected.
    console.log(`Wrote ${baselinePath}`);
  }
  process.exitCode = outcome.exitCode;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const isUpdateMode = args.includes('--update-baseline');
  const allowRegression = args.includes('--allow-regression');

  if (isUpdateMode) {
    runUpdateBaselineMode(allowRegression, BASELINE_PATH);
  } else {
    runNormalMode(BASELINE_PATH);
  }
};

// Only run when executed directly (`node tools/i18n-audit/run-audit.ts`), not
// when imported by tests — otherwise importing this module for its pure
// functions would shell out to the real i18next-cli and touch the real
// baseline.json as a side effect of the import itself.
if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
