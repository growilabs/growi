import {
  parseDefaultLanguageMissingCount,
  parseLocaleMissingCount,
  parseUnusedCount,
} from './parse-status-output';

// Fixtures below are captured verbatim from real `i18next-cli` 1.71.0 stdout
// (see design.md's Stdout Parser risk note: the parser is coupled to this
// version's text format). Captured on the i18n-key-audit branch via:
//   npx i18next-cli status
//   npx i18next-cli status --unused
//   npx i18next-cli status ja_JP

const STATUS_STDOUT_NORMAL = `
- Analyzing project localization status...

✔ Analysis complete.

i18next Project Status
------------------------
🔑 Keys Found:         1734
📚 Namespaces Found:   4
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■□□] 90% (1554/1734 keys)  — 1 untranslated, 179 absent
- zh_CN: [■■■■■■■■■■■■■■■■■□□□] 89% (1536/1734 keys)  — 1 untranslated, 197 absent
- fr_FR: [■■■■■■■■■■■■■■■■■□□□] 88% (1523/1734 keys)  — 1 untranslated, 210 absent
- ko_KR: [■■■■■■■■■■■■■■■■■□□□] 87% (1506/1734 keys)  — 228 absent

⚠ Primary language "en_US" is missing 176 key(s) that are used in code.
  Run "i18next-cli status en_US" for details, or "i18next-cli extract" to add them.
✖ Error: Incomplete translations detected.
`;

// Captured verbatim from real `i18next-cli` 1.71.0 stdout on this repo via:
//   NO_COLOR=1 npx i18next-cli status
// Task 7.3 brought the repo's `en_US` missing-key count to 0, so the whole
// "Primary language ... is missing N key(s)" line is omitted entirely — not
// just the digit zeroed out. This is the same class of "0 count omits the
// line" behavior task 1.5 found for `parseLocaleMissingCount`'s "X
// untranslated," clause, but here the *entire* summary line drops rather
// than one clause within it. The run still exits non-zero and prints
// "✖ Error: Incomplete translations detected." because the non-default
// locales (ja_JP, zh_CN, fr_FR, ko_KR) still have absent keys.
const STATUS_STDOUT_ZERO_MISSING = `
- Analyzing project localization status...

✔ Analysis complete.

i18next Project Status
------------------------
🔑 Keys Found:         1699
📚 Namespaces Found:   3
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■■□] 99% (1679/1699 keys)  — 1 untranslated, 19 absent
- zh_CN: [■■■■■■■■■■■■■■■■■■■□] 98% (1659/1699 keys)  — 1 untranslated, 39 absent
- fr_FR: [■■■■■■■■■■■■■■■■■■■□] 98% (1659/1699 keys)  — 1 untranslated, 39 absent
- ko_KR: [■■■■■■■■■■■■■■■■■■■□] 97% (1647/1699 keys)  — 52 absent
✖ Error: Incomplete translations detected.
`;

// Adversarial: the real report header and Translation Progress section are
// present verbatim, but the "Primary language ... is missing N key(s)" line
// is reworded into a shape the strict regex does not match. A CLI wording
// change like this must throw, not silently read as "0 missing" — this is
// the reviewer's REMEDIATION case 1 for task 1.6's round-1 rejection.
const STATUS_STDOUT_MISSING_LINE_REWORDED = `
- Analyzing project localization status...

✔ Analysis complete.

i18next Project Status
------------------------
🔑 Keys Found:         1734
📚 Namespaces Found:   4
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■□□] 90% (1554/1734 keys)  — 1 untranslated, 179 absent
- zh_CN: [■■■■■■■■■■■■■■■■■□□□] 89% (1536/1734 keys)  — 1 untranslated, 197 absent
- fr_FR: [■■■■■■■■■■■■■■■■■□□□] 88% (1523/1734 keys)  — 1 untranslated, 210 absent
- ko_KR: [■■■■■■■■■■■■■■■■■□□□] 87% (1506/1734 keys)  — 228 absent

⚠ The primary language en_US has 176 keys missing that are used in code.
  Run "i18next-cli status en_US" for details, or "i18next-cli extract" to add them.
✖ Error: Incomplete translations detected.
`;

// Real production stdout, per this module's own doc comment, never contains
// the CLI's "✖ Error: ..." line at all (that line is written to stderr; the
// run-audit.ts caller only ever hands this function the stdout stream). Every
// other fixture in this file embeds "✖ Error:" for readability of a full
// captured session, so on its own that would leave the no-error-marker path
// (slotEndIndex falling back to stdout.length) untested against a shape that
// actually matches production input. This fixture is STATUS_STDOUT_ZERO_MISSING
// with the stderr-only line removed, confirming the slot-emptiness check
// still reads a genuine 0 when there is no "✖ Error:" to anchor against.
const STATUS_STDOUT_ZERO_MISSING_NO_ERROR_MARKER = `
- Analyzing project localization status...

✔ Analysis complete.

i18next Project Status
------------------------
🔑 Keys Found:         1699
📚 Namespaces Found:   3
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■■□] 99% (1679/1699 keys)  — 1 untranslated, 19 absent
- zh_CN: [■■■■■■■■■■■■■■■■■■■□] 98% (1659/1699 keys)  — 1 untranslated, 39 absent
- fr_FR: [■■■■■■■■■■■■■■■■■■■□] 98% (1659/1699 keys)  — 1 untranslated, 39 absent
- ko_KR: [■■■■■■■■■■■■■■■■■■■□] 97% (1647/1699 keys)  — 52 absent
`;

// Adversarial: the real report header and Translation Progress section are
// present verbatim, and the missing-line is reworded to avoid the literal
// word "missing" entirely (unlike STATUS_STDOUT_MISSING_LINE_REWORDED above,
// which still contains that word). A vocabulary sniff for "missing" would
// miss this rewording and silently return 0; this is the reviewer's
// REMEDIATION case for task 1.6's round-2 rejection, requiring a structural
// (slot-emptiness) check instead of a keyword sniff.
const STATUS_STDOUT_MISSING_LINE_REWORDED_WITHOUT_KEYWORD = `
- Analyzing project localization status...

✔ Analysis complete.

i18next Project Status
------------------------
🔑 Keys Found:         1734
📚 Namespaces Found:   4
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■□□] 90% (1554/1734 keys)  — 1 untranslated, 179 absent
- zh_CN: [■■■■■■■■■■■■■■■■■□□□] 89% (1536/1734 keys)  — 1 untranslated, 197 absent
- fr_FR: [■■■■■■■■■■■■■■■■■□□□] 88% (1523/1734 keys)  — 1 untranslated, 210 absent
- ko_KR: [■■■■■■■■■■■■■■■■■□□□] 87% (1506/1734 keys)  — 228 absent

⚠ Heads up: en_US currently lacks 42 translation entr(y/ies) referenced by code.
  Run "i18next-cli status en_US" for details, or "i18next-cli extract" to add them.
✖ Error: Incomplete translations detected.
`;

// Adversarial: the real report header is present, but the capture is cut
// short before the point where the primary-language missing-line's presence
// or absence would be conclusive (before the Translation Progress section
// even finishes, well before either the missing-line or the terminal
// "✖ Error:" marker could appear). A truncated/corrupted capture like this
// must throw, not silently read as "0 missing" — this is the reviewer's
// REMEDIATION case 2 for task 1.6's round-1 rejection.
const STATUS_STDOUT_TRUNCATED_BEFORE_MISSING_LINE = `
- Analyzing project localization status...

✔ Analysis complete.

i18next Project Status
------------------------
🔑 Keys Found:         1734
📚 Namespaces Found:   4
🌍 Locales:            en_US, ja_JP, zh_CN, fr_FR, ko_KR
✅ Primary Language:   en_US

Translation Progress:
- ja_JP: [■■■■■■■■■■■■■■■■■■□□] 90% (1554/1734 keys)  — 1 untranslated, 179 absent
`;

const STATUS_STDOUT_UNPARSEABLE = `
- Analyzing project localization status...

✔ Analysis complete.

Everything looks fine, nothing to report.
`;

const UNUSED_STDOUT_NORMAL_TAIL = `
  ✗ user_management.user_table.accept
  ✗ user_management.user_table.reset_password

Summary: Found 1992 unused key(s). No files were modified.
Run npx i18next-cli extract to remove them.
`;

// Synthesized: same summary sentence shape, count zeroed, no key list body.
const UNUSED_STDOUT_ZERO = `
- Analyzing project for unused translation keys...

✔ Analysis complete.

Summary: Found 0 unused key(s). No files were modified.
`;

const UNUSED_STDOUT_UNPARSEABLE = `
- Analyzing project for unused translation keys...

✔ Analysis complete.

All keys are used. Nothing to report.
`;

const LOCALE_STDOUT_NORMAL_TAIL = `
  ✗ security_settings.read_only_users_comment.accept  (absent)
  ✗ security_settings.read_only_users_comment.deny  (absent)
  ✓ Only inside the group

Summary: Found 180 incomplete translations for "ja_JP" — 1 untranslated, 179 absent.
✖ Error: Incomplete translations detected for "ja_JP".
`;

// Synthesized: same summary sentence shape with locale's absent count zeroed.
const LOCALE_STDOUT_ZERO = `
- Analyzing project localization status...

✔ Analysis complete.

Key Status for "ja_JP":
Overall: [■■■■■■■■■■■■■■■■■■■■] 100% (1734/1734)

Summary: Found 0 incomplete translations for "ja_JP" — 0 untranslated, 0 absent.
`;

const LOCALE_STDOUT_UNPARSEABLE = `
- Analyzing project localization status...

✔ Analysis complete.

Key Status for "ja_JP":
Everything matches. Nothing to report.
`;

// Captured verbatim from real `i18next-cli` 1.71.0 stdout on this repo via:
//   npx i18next-cli status ko_KR
// The "X untranslated," clause is entirely absent here. Per task 1.5's
// investigation (tasks.md Implementation Notes, 2.1), this clause drops out
// whenever the untranslated count is exactly 0 — it is not specific to
// ko_KR, so any locale can hit this shape once its untranslated count reaches 0.
const LOCALE_STDOUT_NO_UNTRANSLATED_CLAUSE = `
- Analyzing project localization status...

✔ Analysis complete.

Key Status for "ko_KR":
Overall: [■■■■■■■■■■■■■■■■■□□□] 87% (1506/1734)

  ✗ security_settings.read_only_users_comment.accept  (absent)
  ✗ security_settings.read_only_users_comment.deny  (absent)
  ✓ Only inside the group

Summary: Found 228 incomplete translations for "ko_KR" — 228 absent.
✖ Error: Incomplete translations detected for "ko_KR".
`;

describe('parseDefaultLanguageMissingCount', () => {
  it('extracts the missing-key count from a normal `status` run', () => {
    expect(parseDefaultLanguageMissingCount(STATUS_STDOUT_NORMAL)).toBe(176);
  });

  it('extracts 0 when the primary language has no missing keys', () => {
    expect(parseDefaultLanguageMissingCount(STATUS_STDOUT_ZERO_MISSING)).toBe(
      0,
    );
  });

  it('throws when the expected summary line is absent', () => {
    expect(() =>
      parseDefaultLanguageMissingCount(STATUS_STDOUT_UNPARSEABLE),
    ).toThrow();
  });

  it('throws when the report header is present but the missing-line wording changed instead of being genuinely absent', () => {
    expect(() =>
      parseDefaultLanguageMissingCount(STATUS_STDOUT_MISSING_LINE_REWORDED),
    ).toThrow();
  });

  it('extracts 0 when there is no missing-line AND no "✖ Error:" marker at all, matching the real stdout-only shape (no stderr content mixed in)', () => {
    expect(
      parseDefaultLanguageMissingCount(
        STATUS_STDOUT_ZERO_MISSING_NO_ERROR_MARKER,
      ),
    ).toBe(0);
  });

  it('throws with a message identifying unrecognized slot text when the missing-line is reworded to avoid the literal word "missing" entirely (structural slot check, not a keyword sniff)', () => {
    expect(() =>
      parseDefaultLanguageMissingCount(
        STATUS_STDOUT_MISSING_LINE_REWORDED_WITHOUT_KEYWORD,
      ),
    ).toThrow(/unrecognized text/);
  });

  it("throws when the report header is present but the capture is truncated before the missing-line's presence or absence is conclusive", () => {
    expect(() =>
      parseDefaultLanguageMissingCount(
        STATUS_STDOUT_TRUNCATED_BEFORE_MISSING_LINE,
      ),
    ).toThrow();
  });
});

describe('parseUnusedCount', () => {
  it('extracts the unused-key count from a normal `status --unused` run', () => {
    expect(parseUnusedCount(UNUSED_STDOUT_NORMAL_TAIL)).toBe(1992);
  });

  it('extracts 0 when there are no unused keys', () => {
    expect(parseUnusedCount(UNUSED_STDOUT_ZERO)).toBe(0);
  });

  it('throws when the expected summary line is absent', () => {
    expect(() => parseUnusedCount(UNUSED_STDOUT_UNPARSEABLE)).toThrow();
  });
});

describe('parseLocaleMissingCount', () => {
  it('extracts the absent-key count (not the untranslated count) for the given locale', () => {
    expect(parseLocaleMissingCount(LOCALE_STDOUT_NORMAL_TAIL, 'ja_JP')).toBe(
      179,
    );
  });

  it('extracts 0 when the locale has no absent keys', () => {
    expect(parseLocaleMissingCount(LOCALE_STDOUT_ZERO, 'ja_JP')).toBe(0);
  });

  it('throws when the expected summary line is absent', () => {
    expect(() =>
      parseLocaleMissingCount(LOCALE_STDOUT_UNPARSEABLE, 'ja_JP'),
    ).toThrow();
  });

  it('throws when the summary line is for a different locale than requested', () => {
    expect(() =>
      parseLocaleMissingCount(LOCALE_STDOUT_NORMAL_TAIL, 'ko_KR'),
    ).toThrow();
  });

  it('extracts the absent count when the "X untranslated," clause is entirely absent (untranslated count is 0)', () => {
    expect(
      parseLocaleMissingCount(LOCALE_STDOUT_NO_UNTRANSLATED_CLAUSE, 'ko_KR'),
    ).toBe(228);
  });
});
