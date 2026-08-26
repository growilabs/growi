import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { I18nAuditBaseline } from './baseline';
import {
  type AuditMeasurements,
  type CheckResult,
  decideAudit,
  decideBaselineUpdate,
  runNormalMode,
  runUpdateBaselineMode,
} from './run-audit';

// Helpers to build CheckResult fixtures concisely.
const ok = (value: number): CheckResult => ({ status: 'ok', value });
const err = (message: string): CheckResult => ({ status: 'error', message });

const BASELINE: I18nAuditBaseline = {
  unusedKeys: 100,
  missingByLocale: { ja_JP: 10, zh_CN: 20 },
};

const allPassingMeasurements: AuditMeasurements = {
  defaultLanguageMissing: ok(0),
  unusedKeys: ok(90),
  missingByLocale: { ja_JP: ok(5), zh_CN: ok(20) },
};

describe('decideAudit', () => {
  it('passes and exits 0 when every metric is within its baseline / target', () => {
    const decision = decideAudit(allPassingMeasurements, BASELINE);

    expect(decision.pass).toBe(true);
    expect(decision.exitCode).toBe(0);
  });

  it('fails when the default-language missing-key count is above 0 (Requirement 1: not baseline-tracked)', () => {
    const decision = decideAudit(
      { ...allPassingMeasurements, defaultLanguageMissing: ok(1) },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
    expect(decision.exitCode).not.toBe(0);
    expect(decision.lines.some((line) => line.includes('must be 0'))).toBe(
      true,
    );
  });

  it('fails when the unused-key count exceeds the baseline', () => {
    const decision = decideAudit(
      { ...allPassingMeasurements, unusedKeys: ok(101) },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
    expect(decision.exitCode).not.toBe(0);
    expect(
      decision.lines.some((line) => line.includes('unused-key count')),
    ).toBe(true);
  });

  it("fails when a single locale's missing-key count exceeds its baseline, even if others pass", () => {
    const decision = decideAudit(
      {
        ...allPassingMeasurements,
        missingByLocale: { ja_JP: ok(5), zh_CN: ok(21) },
      },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
    expect(decision.exitCode).not.toBe(0);
    expect(decision.lines.some((line) => line.includes('zh_CN'))).toBe(true);
  });

  it('treats a parse failure on the default-language check as a failure, never a pass', () => {
    const decision = decideAudit(
      {
        ...allPassingMeasurements,
        defaultLanguageMissing: err('could not find expected summary line'),
      },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
    expect(decision.exitCode).not.toBe(0);
  });

  it('treats a parse failure on the unused-key check as a failure, never a pass', () => {
    const decision = decideAudit(
      { ...allPassingMeasurements, unusedKeys: err('unparseable stdout') },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
    expect(decision.exitCode).not.toBe(0);
  });

  it('treats a parse failure on a per-locale check as a failure, never a pass', () => {
    const decision = decideAudit(
      {
        ...allPassingMeasurements,
        missingByLocale: { ja_JP: ok(5), zh_CN: err('unparseable stdout') },
      },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
    expect(decision.exitCode).not.toBe(0);
  });

  it('treats a locale with no baseline entry as an implicit baseline of 0', () => {
    const decision = decideAudit(
      {
        ...allPassingMeasurements,
        missingByLocale: { ja_JP: ok(5), zh_CN: ok(20), fr_FR: ok(1) },
      },
      BASELINE,
    );

    expect(decision.pass).toBe(false);
  });
});

describe('decideBaselineUpdate', () => {
  it('prints the before -> after delta to consoleLines and returns the new baseline to write', () => {
    const measurements: AuditMeasurements = {
      defaultLanguageMissing: ok(0),
      unusedKeys: ok(80),
      missingByLocale: { ja_JP: ok(5), zh_CN: ok(20) },
    };

    const outcome = decideBaselineUpdate(measurements, BASELINE, {
      allowRegression: false,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.writeBaseline).toEqual({
      unusedKeys: 80,
      missingByLocale: { ja_JP: 5, zh_CN: 20 },
    });
    // The flagged requirement: the actual before/after numbers must be visible.
    expect(
      outcome.consoleLines.some(
        (line) => line.includes('unusedKeys') && line.includes('100 -> 80'),
      ),
    ).toBe(true);
    expect(
      outcome.consoleLines.some(
        (line) =>
          line.includes('missingByLocale.ja_JP') && line.includes('10 -> 5'),
      ),
    ).toBe(true);
  });

  it('writes the measurement as-is on first run (existing baseline is null), without requiring --allow-regression', () => {
    const measurements: AuditMeasurements = {
      defaultLanguageMissing: ok(0),
      unusedKeys: ok(176),
      missingByLocale: { ja_JP: ok(92) },
    };

    const outcome = decideBaselineUpdate(measurements, null, {
      allowRegression: false,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.writeBaseline).toEqual({
      unusedKeys: 176,
      missingByLocale: { ja_JP: 92 },
    });
    expect(outcome.consoleLines.length).toBeGreaterThan(0);
  });

  it('rejects a regressing update without --allow-regression, printing an error and writing nothing', () => {
    const measurements: AuditMeasurements = {
      defaultLanguageMissing: ok(0),
      unusedKeys: ok(150), // worse than baseline's 100
      missingByLocale: { ja_JP: ok(10), zh_CN: ok(20) },
    };

    const outcome = decideBaselineUpdate(measurements, BASELINE, {
      allowRegression: false,
    });

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.writeBaseline).toBeNull();
    expect(outcome.errorLines.length).toBeGreaterThan(0);
    expect(outcome.errorLines.some((line) => line.includes('unusedKeys'))).toBe(
      true,
    );
  });

  it('accepts a regressing update when --allow-regression is set', () => {
    const measurements: AuditMeasurements = {
      defaultLanguageMissing: ok(0),
      unusedKeys: ok(150),
      missingByLocale: { ja_JP: ok(10), zh_CN: ok(20) },
    };

    const outcome = decideBaselineUpdate(measurements, BASELINE, {
      allowRegression: true,
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.writeBaseline?.unusedKeys).toBe(150);
  });

  it('aborts without writing when any measurement errored', () => {
    const measurements: AuditMeasurements = {
      defaultLanguageMissing: ok(0),
      unusedKeys: err('unparseable stdout'),
      missingByLocale: { ja_JP: ok(5) },
    };

    const outcome = decideBaselineUpdate(measurements, BASELINE, {
      allowRegression: false,
    });

    expect(outcome.exitCode).not.toBe(0);
    expect(outcome.writeBaseline).toBeNull();
    expect(
      outcome.errorLines.some((line) => line.includes('unparseable stdout')),
    ).toBe(true);
  });
});

// Integration-style tests using fixture baseline.json files on disk (task
// 1.4's `fs.mkdtempSync` pattern) AND fixture `i18next-cli` stdout (reusing
// the shape of the real captures embedded in parse-status-output.spec.ts),
// per this task's own observable completion condition. `node:child_process`
// is mocked so these tests never spawn the real `i18next-cli` and never
// depend on the current, ever-changing real key counts in this repo.
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

// Includes the "✅ Primary Language:" header and a full Translation Progress
// section (one line per secondary locale below) because
// `parseDefaultLanguageMissingCount` requires both as a structural sanity
// anchor before it will read "no strict line present" as a genuine 0 — see
// parse-status-output.ts's doc comment.
const STATUS_STDOUT_ZERO_MISSING = `
i18next Project Status
------------------------
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■■■] 100% (0/0 keys)  — 0 absent
- zh_CN: [■■■■■■■■■■■■■■■■■■■■] 100% (0/0 keys)  — 0 absent
- fr_FR: [■■■■■■■■■■■■■■■■■■■■] 100% (0/0 keys)  — 0 absent
- ko_KR: [■■■■■■■■■■■■■■■■■■■■] 100% (0/0 keys)  — 0 absent
`;

const UNUSED_STDOUT = `
Summary: Found 80 unused key(s). No files were modified.
`;

// Matches the shape `parseLocaleMissingCount` requires: "N untranslated, M
// absent" (see parse-status-output.ts). Note: the real `i18next-cli` output
// observed against this repo's actual ko_KR data omits the "X untranslated,"
// clause entirely when that count is 0 (e.g. `— 228 absent.` with no
// leading clause) — a pre-existing Stdout Parser gap outside this task's
// boundary (Audit Orchestrator), flagged in this task's status report.
const localeStdout = (locale: string, absent: number): string => `
Summary: Found ${absent} incomplete translations for "${locale}" — 0 untranslated, ${absent} absent.
`;

describe('runNormalMode / runUpdateBaselineMode (fixture baseline.json + fixture i18next-cli stdout)', () => {
  let tmpDir: string;
  let baselinePath: string;
  let mockExecFileSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-audit-orchestrator-'));
    baselinePath = path.join(tmpDir, 'baseline.json');
    process.exitCode = undefined;

    const childProcess = await import('node:child_process');
    mockExecFileSync = vi.mocked(childProcess.execFileSync);
    mockExecFileSync.mockReset();
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--unused')) {
        return UNUSED_STDOUT;
      }
      const locale = args[args.length - 1];
      if (locale === 'status') {
        return STATUS_STDOUT_ZERO_MISSING;
      }
      return localeStdout(locale, 0);
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it('runNormalMode sets a non-zero exit code when baseline.json does not exist yet, without crashing (real-repo pre-8.1 expectation)', () => {
    expect(() => runNormalMode(baselinePath)).not.toThrow();
    expect(process.exitCode).not.toBe(0);
    // Must fail before even attempting to measure — baseline.json is read first.
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('runNormalMode exits 0 when a fixture baseline.json exists and every measurement is within it', () => {
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        unusedKeys: 80,
        missingByLocale: { ja_JP: 0, zh_CN: 0, fr_FR: 0, ko_KR: 0 },
      }),
    );

    runNormalMode(baselinePath);

    expect(process.exitCode).toBe(0);
  });

  it('runNormalMode exits non-zero when the fixture baseline.json is stricter than the measured unused-key count', () => {
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        unusedKeys: 10, // measured (80) exceeds this
        missingByLocale: { ja_JP: 0, zh_CN: 0, fr_FR: 0, ko_KR: 0 },
      }),
    );

    runNormalMode(baselinePath);

    expect(process.exitCode).not.toBe(0);
  });

  it('runUpdateBaselineMode on first run (no existing baseline.json) writes the file and prints the delta to stdout via console.log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let printed: string;
    try {
      runUpdateBaselineMode(false, baselinePath);
      // Read the captured calls BEFORE mockRestore(), which clears call history.
      printed = logSpy.mock.calls.map(([line]) => line).join('\n');
    } finally {
      logSpy.mockRestore();
    }

    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(baselinePath)).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(baselinePath, 'utf-8'),
    ) as I18nAuditBaseline;
    expect(written.unusedKeys).toBe(80);

    // The flagged requirement: the actual delta must reach real stdout
    // through console.log, not just be computable in memory.
    expect(printed).toContain('unusedKeys');
    expect(printed).toContain('0 -> 80');
  });

  it('runUpdateBaselineMode prints the real before -> after delta when an existing fixture baseline.json is updated', () => {
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        unusedKeys: 100,
        missingByLocale: { ja_JP: 5, zh_CN: 0, fr_FR: 0, ko_KR: 0 },
      }),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let printed: string;
    try {
      runUpdateBaselineMode(false, baselinePath);
      printed = logSpy.mock.calls.map(([line]) => line).join('\n');
    } finally {
      logSpy.mockRestore();
    }

    expect(process.exitCode).toBe(0);
    expect(printed).toContain('unusedKeys: 100 -> 80');
    expect(printed).toContain('missingByLocale.ja_JP: 5 -> 0');
  });

  it('runUpdateBaselineMode refuses to write when a check errors (parse failure), and never treats it as pass', () => {
    mockExecFileSync.mockImplementation((_command: string, args: string[]) => {
      if (args.includes('--unused')) {
        return 'unparseable garbage, no summary line';
      }
      const locale = args[args.length - 1];
      if (locale === 'status') {
        return STATUS_STDOUT_ZERO_MISSING;
      }
      return localeStdout(locale, 0);
    });

    runUpdateBaselineMode(false, baselinePath);

    expect(process.exitCode).not.toBe(0);
    expect(fs.existsSync(baselinePath)).toBe(false);
  });
});
