import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  BaselineNotFoundError,
  BaselineRegressionError,
  computeBaselineUpdate,
  evaluateAgainstBaseline,
  type I18nAuditBaseline,
  readBaselineFile,
  tryReadBaselineFile,
  writeBaselineFile,
} from './baseline';

describe('evaluateAgainstBaseline', () => {
  const baseline: I18nAuditBaseline = {
    unusedKeys: 10,
    missingByLocale: { ja_JP: 5, zh_CN: 3 },
  };

  it('passes when the measured count is below the baseline', () => {
    const result = evaluateAgainstBaseline(
      { unusedKeys: 9, missingByLocale: { ja_JP: 4 } },
      baseline,
    );

    expect(result.pass).toBe(true);
    expect(result.unusedKeys).toEqual({
      measured: 9,
      baseline: 10,
      pass: true,
    });
    expect(result.missingByLocale.ja_JP).toEqual({
      measured: 4,
      baseline: 5,
      pass: true,
    });
  });

  it('fails when the measured count exceeds the baseline', () => {
    const result = evaluateAgainstBaseline(
      { unusedKeys: 11, missingByLocale: { ja_JP: 5 } },
      baseline,
    );

    expect(result.pass).toBe(false);
    expect(result.unusedKeys.pass).toBe(false);
  });

  it('passes at the boundary where the measured count equals the baseline exactly', () => {
    const result = evaluateAgainstBaseline(
      { unusedKeys: 10, missingByLocale: { zh_CN: 3 } },
      baseline,
    );

    expect(result.pass).toBe(true);
    expect(result.unusedKeys).toEqual({
      measured: 10,
      baseline: 10,
      pass: true,
    });
    expect(result.missingByLocale.zh_CN).toEqual({
      measured: 3,
      baseline: 3,
      pass: true,
    });
  });

  it('treats a locale with no recorded baseline entry as a baseline of 0, not an automatic pass', () => {
    // fr_FR has no entry in `baseline.missingByLocale` above.
    const failing = evaluateAgainstBaseline(
      { unusedKeys: 0, missingByLocale: { fr_FR: 1 } },
      baseline,
    );
    expect(failing.pass).toBe(false);
    expect(failing.missingByLocale.fr_FR).toEqual({
      measured: 1,
      baseline: 0,
      pass: false,
    });

    // Zero missing for an unrecorded locale still passes against the implied 0 baseline.
    const passing = evaluateAgainstBaseline(
      { unusedKeys: 0, missingByLocale: { fr_FR: 0 } },
      baseline,
    );
    expect(passing.pass).toBe(true);
  });

  it('fails overall if any single locale fails even when others pass', () => {
    const result = evaluateAgainstBaseline(
      { unusedKeys: 0, missingByLocale: { ja_JP: 5, zh_CN: 4 } },
      baseline,
    );
    expect(result.pass).toBe(false);
    expect(result.missingByLocale.ja_JP.pass).toBe(true);
    expect(result.missingByLocale.zh_CN.pass).toBe(false);
  });
});

describe('computeBaselineUpdate', () => {
  it('allows the first-ever write (no existing baseline) without requiring allowRegression', () => {
    const result = computeBaselineUpdate(
      { unusedKeys: 42, missingByLocale: { ja_JP: 7 } },
      null,
    );

    expect(result.baseline).toEqual({
      unusedKeys: 42,
      missingByLocale: { ja_JP: 7 },
    });
    expect(result.changes).toEqual(
      expect.arrayContaining([
        { metric: 'unusedKeys', before: 0, after: 42 },
        { metric: 'missingByLocale.ja_JP', before: 0, after: 7 },
      ]),
    );
  });

  it('rejects a regressing update (measured worse than existing baseline) without allowRegression', () => {
    const existing: I18nAuditBaseline = {
      unusedKeys: 10,
      missingByLocale: { ja_JP: 5 },
    };

    expect(() =>
      computeBaselineUpdate(
        { unusedKeys: 12, missingByLocale: { ja_JP: 5 } },
        existing,
      ),
    ).toThrow(BaselineRegressionError);
  });

  it('accepts a regressing update when allowRegression is explicitly set', () => {
    const existing: I18nAuditBaseline = {
      unusedKeys: 10,
      missingByLocale: { ja_JP: 5 },
    };

    const result = computeBaselineUpdate(
      { unusedKeys: 12, missingByLocale: { ja_JP: 5 } },
      existing,
      { allowRegression: true },
    );

    expect(result.baseline.unusedKeys).toBe(12);
    expect(result.changes).toEqual(
      expect.arrayContaining([{ metric: 'unusedKeys', before: 10, after: 12 }]),
    );
  });

  it('reports the before/after delta even for an improving (non-regressing) update', () => {
    const existing: I18nAuditBaseline = {
      unusedKeys: 10,
      missingByLocale: { ja_JP: 5 },
    };

    const result = computeBaselineUpdate(
      { unusedKeys: 8, missingByLocale: { ja_JP: 5 } },
      existing,
    );

    expect(result.changes).toEqual([
      { metric: 'unusedKeys', before: 10, after: 8 },
    ]);
  });

  it('does not report a change for a metric whose value is unchanged', () => {
    const existing: I18nAuditBaseline = {
      unusedKeys: 10,
      missingByLocale: { ja_JP: 5 },
    };

    const result = computeBaselineUpdate(
      { unusedKeys: 10, missingByLocale: { ja_JP: 5 } },
      existing,
    );

    expect(result.changes).toEqual([]);
  });
});

describe('readBaselineFile / tryReadBaselineFile / writeBaselineFile (real filesystem)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-audit-baseline-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws BaselineNotFoundError when the file does not exist (first-run scenario)', () => {
    const missingPath = path.join(tmpDir, 'baseline.json');
    expect(() => readBaselineFile(missingPath)).toThrow(BaselineNotFoundError);
  });

  it('returns null from tryReadBaselineFile when the file does not exist', () => {
    const missingPath = path.join(tmpDir, 'baseline.json');
    expect(tryReadBaselineFile(missingPath)).toBeNull();
  });

  it('reads back a baseline that was written by writeBaselineFile', () => {
    const filePath = path.join(tmpDir, 'baseline.json');
    const baseline: I18nAuditBaseline = {
      unusedKeys: 3,
      missingByLocale: { ja_JP: 1, ko_KR: 2 },
    };

    writeBaselineFile(filePath, baseline);

    expect(readBaselineFile(filePath)).toEqual(baseline);
    expect(tryReadBaselineFile(filePath)).toEqual(baseline);
  });

  it('propagates a non-ENOENT error (malformed JSON) instead of treating it as "not found"', () => {
    const filePath = path.join(tmpDir, 'baseline.json');
    fs.writeFileSync(filePath, '{ this is not valid json', 'utf-8');

    expect(() => readBaselineFile(filePath)).toThrow();
    expect(() => readBaselineFile(filePath)).not.toThrow(BaselineNotFoundError);
    expect(() => tryReadBaselineFile(filePath)).toThrow();
  });
});
