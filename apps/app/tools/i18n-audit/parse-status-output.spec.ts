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

// Synthesized from the normal fixture's structure with the count zeroed out.
// The real repo has 176 missing keys today (see task 1.1/1.2), so a genuine
// zero-missing run cannot be captured; this represents what the same CLI
// would print once the count reaches zero, per the observed sentence shape.
const STATUS_STDOUT_ZERO_MISSING = `
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

⚠ Primary language "en_US" is missing 0 key(s) that are used in code.
  Run "i18next-cli status en_US" for details, or "i18next-cli extract" to add them.
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
});
