/**
 * Baseline Store: reads, compares, and updates
 * `apps/app/tools/i18n-audit/baseline.json`, the recorded counts (unused-key
 * count and per-locale missing-key counts) against which the Audit
 * Orchestrator (task 2.1) judges a measurement "pass" or "fail"
 * (design.md: Components and Interfaces > Tooling > Baseline Store, State contract).
 *
 * This module never invokes `i18next-cli` and never decides what to measure —
 * the orchestrator owns command execution and passes in already-measured
 * numbers here. File I/O (`readBaselineFile` / `writeBaselineFile` /
 * `tryReadBaselineFile`) is kept at the boundary; the comparison and update
 * logic (`evaluateAgainstBaseline`, `computeBaselineUpdate`) is pure, per
 * coding-style.md's Pure Function Extraction principle.
 */

import * as fs from 'node:fs';

export type LocaleMissingCounts = Record<string, number>;

export interface I18nAuditBaseline {
  /** `status --unused` unused-key count baseline. */
  unusedKeys: number;
  /** Per-locale absent-key count baseline, keyed by locale (e.g. "ja_JP"). */
  missingByLocale: LocaleMissingCounts;
}

export interface I18nAuditMeasurement {
  unusedKeys: number;
  missingByLocale: LocaleMissingCounts;
}

/**
 * Thrown by {@link readBaselineFile} when the baseline file does not exist.
 * Distinguished from other read failures (malformed JSON, permission
 * errors) so callers can special-case the first-run scenario in design.md's
 * Error Handling section: a missing file is a hard failure during normal
 * (CI) execution, but is expected and allowed during the very first
 * `--update-baseline` run.
 */
export class BaselineNotFoundError extends Error {
  constructor(filePath: string) {
    super(`Baseline file not found: ${filePath}`);
    this.name = 'BaselineNotFoundError';
  }
}

export interface MetricChange {
  /** e.g. "unusedKeys" or "missingByLocale.ja_JP" */
  metric: string;
  before: number;
  after: number;
}

/**
 * Thrown by {@link computeBaselineUpdate} when a measurement is worse
 * (larger) than the existing baseline for at least one metric and the
 * caller did not explicitly allow regression (`--allow-regression`).
 */
export class BaselineRegressionError extends Error {
  readonly regressions: readonly MetricChange[];

  constructor(regressions: readonly MetricChange[]) {
    super(
      'Refusing to update baseline: measured value regressed for ' +
        `${regressions.map((r) => `${r.metric} (${r.before} -> ${r.after})`).join(', ')}. ` +
        'Pass --allow-regression to override.',
    );
    this.name = 'BaselineRegressionError';
    this.regressions = regressions;
  }
}

export interface MetricEvaluation {
  measured: number;
  baseline: number;
  pass: boolean;
}

export interface BaselineEvaluationResult {
  pass: boolean;
  unusedKeys: MetricEvaluation;
  missingByLocale: Record<string, MetricEvaluation>;
}

// measured <= baseline passes; equal counts as pass (design.md Baseline Store).
const evaluateMetric = (
  measured: number,
  baseline: number,
): MetricEvaluation => ({
  measured,
  baseline,
  pass: measured <= baseline,
});

// A locale with no recorded baseline entry is treated as a baseline of 0, not
// as an automatic pass, so any measured count above 0 fails for it
// (design.md: "その言語で1件でも欠損があれば不合格になる").
const getLocaleBaseline = (
  baseline: I18nAuditBaseline,
  locale: string,
): number => baseline.missingByLocale[locale] ?? 0;

/**
 * Compares a measurement against the recorded baseline. Pure — no file I/O.
 */
export const evaluateAgainstBaseline = (
  measured: I18nAuditMeasurement,
  baseline: I18nAuditBaseline,
): BaselineEvaluationResult => {
  const unusedKeys = evaluateMetric(measured.unusedKeys, baseline.unusedKeys);

  const missingByLocale: Record<string, MetricEvaluation> = {};
  for (const [locale, count] of Object.entries(measured.missingByLocale)) {
    missingByLocale[locale] = evaluateMetric(
      count,
      getLocaleBaseline(baseline, locale),
    );
  }

  const pass =
    unusedKeys.pass && Object.values(missingByLocale).every((r) => r.pass);

  return { pass, unusedKeys, missingByLocale };
};

const collectChanges = (
  measured: I18nAuditMeasurement,
  existing: I18nAuditBaseline | null,
): MetricChange[] => {
  const changes: MetricChange[] = [];

  const existingUnused = existing?.unusedKeys ?? 0;
  if (measured.unusedKeys !== existingUnused) {
    changes.push({
      metric: 'unusedKeys',
      before: existingUnused,
      after: measured.unusedKeys,
    });
  }

  for (const [locale, count] of Object.entries(measured.missingByLocale)) {
    const before = existing?.missingByLocale[locale] ?? 0;
    if (count !== before) {
      changes.push({
        metric: `missingByLocale.${locale}`,
        before,
        after: count,
      });
    }
  }

  return changes;
};

export interface BaselineUpdateResult {
  baseline: I18nAuditBaseline;
  /**
   * Every metric whose value would change, before -> after, including
   * improvements. design.md requires the before/after delta to always be
   * surfaced on `--update-baseline`, even for an improving update; this
   * module returns that delta as data rather than printing it itself —
   * printing to stdout is the orchestrator's (task 2.1) responsibility.
   */
  changes: readonly MetricChange[];
}

/**
 * Computes the new baseline for a `--update-baseline` run and the set of
 * changes it would make. Pure — does not touch the filesystem.
 *
 * `existing === null` signals the first-ever run (no `baseline.json` yet):
 * per design.md, the regression guard does not apply in that case and the
 * measurement is written as-is, without requiring `allowRegression`.
 *
 * @throws {BaselineRegressionError} if `existing` is non-null, at least one
 *   metric would regress (measured worse than existing baseline), and
 *   `options.allowRegression` is not set.
 */
export const computeBaselineUpdate = (
  measured: I18nAuditMeasurement,
  existing: I18nAuditBaseline | null,
  options: { allowRegression: boolean } = { allowRegression: false },
): BaselineUpdateResult => {
  const changes = collectChanges(measured, existing);

  if (existing != null) {
    const regressions = changes.filter((c) => c.after > c.before);
    if (regressions.length > 0 && !options.allowRegression) {
      throw new BaselineRegressionError(regressions);
    }
  }

  const baseline: I18nAuditBaseline = {
    unusedKeys: measured.unusedKeys,
    missingByLocale: { ...measured.missingByLocale },
  };

  return { baseline, changes };
};

/**
 * Reads and parses `baseline.json`. Throws {@link BaselineNotFoundError} if
 * the file does not exist, and propagates any other error (malformed JSON,
 * permission failure, etc.) as-is — callers must not fall back to a default
 * value on a read failure other than "file missing" (design.md Error
 * Handling: no silent fallback to an ambiguous default).
 */
export const readBaselineFile = (filePath: string): I18nAuditBaseline => {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BaselineNotFoundError(filePath);
    }
    throw error;
  }

  return JSON.parse(raw) as I18nAuditBaseline;
};

/**
 * Same as {@link readBaselineFile}, but returns `null` instead of throwing
 * when the file does not exist yet. Intended for the `--update-baseline`
 * first-run case; any non-"missing" read failure (malformed JSON, etc.)
 * still propagates.
 */
export const tryReadBaselineFile = (
  filePath: string,
): I18nAuditBaseline | null => {
  try {
    return readBaselineFile(filePath);
  } catch (error) {
    if (error instanceof BaselineNotFoundError) {
      return null;
    }
    throw error;
  }
};

/** Writes the baseline as pretty-printed JSON with a trailing newline. */
export const writeBaselineFile = (
  filePath: string,
  baseline: I18nAuditBaseline,
): void => {
  fs.writeFileSync(filePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf-8');
};
