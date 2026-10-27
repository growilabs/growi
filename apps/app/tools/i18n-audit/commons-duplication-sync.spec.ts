import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Guards the pairwise sync between `translation.json` and `commons.json` for
 * the shared admin labels that task 7.1 (Bug 2 Remediation) duplicated.
 *
 * Why duplication exists at all: admin pages are served only the `commons`
 * and `admin` namespaces (`translation` is never loaded there — see
 * task-1.2-findings.md §2), so a fixed-string call like `t('commons:Name')`
 * needs `Name` to exist in `commons.json`, even though the label's original,
 * still-canonical value lives in `translation.json`. Task 7.1 copied that
 * value across once; nothing re-derives `commons.json` from `translation.json`
 * afterward, so the two can silently drift the moment either file is edited
 * on its own. This spec is the drift guard for that pair.
 *
 * Per task-1.2-findings.md §2, 23 shared labels were found; 3
 * (`Delete`, `toaster.remove_share_link`, `toaster.remove_share_link_success`)
 * already had a value in `commons.json` and were excluded from duplication.
 * A 21st key, `Done`, was added on top of the 20 remaining ones after
 * re-running task 1.2's own criterion against
 * `Admin/Users/PasswordResetModal.jsx:67` (`t('commons:Done')`), which meets
 * the same "called as a fixed string, not resolvable in the declared
 * namespace, real value in translation.json" test as the other 20 (see
 * task 7.1's Status Report for the full trace).
 */

const LOCALES = ['en_US', 'ja_JP', 'zh_CN', 'fr_FR', 'ko_KR'] as const;

/**
 * The 21 keys duplicated from translation.json into commons.json.
 * Order matches task-1.2-findings.md §2's table, with `Done` inserted in its
 * alphabetical slot.
 */
const DUPLICATED_KEYS = [
  'Cancel',
  'Close',
  'Confirm',
  'Create',
  'Created',
  'Description',
  'Done',
  'Edit',
  'Email',
  'Error occurred',
  'Help',
  'Name',
  'Password',
  'Update',
  'User',
  'UserGroup',
  'V5 Page Migration',
  'Warning',
  'add',
  'eg',
  'username',
] as const;

/**
 * These 5 keys are resolved via the `translation` namespace today (their
 * files call bare `useTranslation()`, so i18next-cli's `status` report
 * doesn't flag them), but will only resolve via `commons` once task 7.2
 * prefixes their call sites with `commons:`. Missing them here would have let
 * a fresh report appear only after 7.2 lands, when it would be far less
 * obvious why.
 */
const KEYS_NOT_YET_VISIBLE_IN_CLI_REPORT = [
  'Confirm',
  'Help',
  'Password',
  'Warning',
  'add',
] as const;

/**
 * `translation.json` itself has no `User` entry in ja_JP or zh_CN (a
 * pre-existing translation gap, unrelated to Bug 2). Task 7.1 does not
 * fabricate a value for these — commons.json is left without `User` there
 * too, so this table documents where a "duplicated" key has nothing to
 * duplicate in a given locale, and the sync test still enforces that both
 * files agree (both absent) rather than silently skipping the pair.
 */
const KNOWN_LOCALE_GAPS: ReadonlyArray<{ key: string; locale: string }> = [
  { key: 'User', locale: 'ja_JP' },
  { key: 'User', locale: 'zh_CN' },
];

/**
 * These 3 (locale, key) pairs pre-date this feature and are intentionally NOT
 * synced with translation.json:
 *
 * - `zh_CN.Close` / `zh_CN.Done`: translation.json's zh_CN values are
 *   themselves untranslated English placeholders ("Close" / "Done"), while
 *   commons.json has carried real Chinese translations ("关闭" / "完成")
 *   since commit 5b834dc268 (2023-06-26, soumaeda, "124062 use commos.json"),
 *   on master, long predating this feature. commons.json's Close/Done are
 *   used live by PasswordResetModal.jsx (admin, on master already — verified
 *   via `git show master:.../PasswordResetModal.jsx`) AND by
 *   SavePageControls.tsx (page-editor save modal, outside this feature's
 *   admin scope). Overwriting them to match translation.json's placeholder
 *   would be a real-user-facing regression, not a fix.
 * - `fr_FR.Edit`: commons.json deliberately pairs View/Edit as
 *   "Lecture"/"Écriture" (Reading/Writing) for PageEditorModeManager.tsx's
 *   live mode-toggle UI (also outside this feature's admin scope), distinct
 *   from translation.json's "Modifier" wording used elsewhere. This value is
 *   from commit 00b8a691ec (2026-02-19, Lanhild, "refactor: enhance french
 *   translations"), on master, also predating this feature.
 *
 * A prior version of this test asserted plain equality with translation.json
 * for all 21 keys, which forced these 3 pairs to be "fixed" by overwriting
 * commons.json's intentional value — a regression caught in review. Pinning
 * the literal here (rather than skipping the pair) still catches accidental
 * drift away from the intentional value.
 */
const KNOWN_INTENTIONAL_DIVERGENCES: ReadonlyArray<{
  locale: string;
  key: string;
  expectedCommonsValue: string;
}> = [
  { locale: 'zh_CN', key: 'Close', expectedCommonsValue: '关闭' },
  { locale: 'zh_CN', key: 'Done', expectedCommonsValue: '完成' },
  { locale: 'fr_FR', key: 'Edit', expectedCommonsValue: 'Écriture' },
];

const findIntentionalDivergence = (key: string, locale: string) =>
  KNOWN_INTENTIONAL_DIVERGENCES.find(
    (divergence) => divergence.key === key && divergence.locale === locale,
  );

const localesDir = path.resolve(
  import.meta.dirname,
  '../../public/static/locales',
);

const readJson = (
  locale: string,
  file: 'translation' | 'commons',
): Record<string, unknown> => {
  const filePath = path.join(localesDir, locale, `${file}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
};

const isKnownGap = (key: string, locale: string): boolean =>
  KNOWN_LOCALE_GAPS.some((gap) => gap.key === key && gap.locale === locale);

describe('commons.json duplication stays in sync with translation.json (task 7.1)', () => {
  it('includes the 5 keys the CLI report cannot see yet (Confirm/Help/Password/Warning/add)', () => {
    for (const key of KEYS_NOT_YET_VISIBLE_IN_CLI_REPORT) {
      expect(DUPLICATED_KEYS).toContain(key);
    }
  });

  describe.each(DUPLICATED_KEYS)('%s', (key) => {
    it.each(
      LOCALES,
    )('matches between translation.json and commons.json in %s', (locale) => {
      const translation = readJson(locale, 'translation');
      const commons = readJson(locale, 'commons');

      if (isKnownGap(key, locale)) {
        // Documented gap: translation.json has no value here either, so
        // commons.json must not have one fabricated for it. Asserting this
        // (rather than skipping the pair) still catches a future regression
        // where only one of the two files gains a value.
        expect(translation[key]).toBeUndefined();
        expect(commons[key]).toBeUndefined();
        return;
      }

      const intentionalDivergence = findIntentionalDivergence(key, locale);
      if (intentionalDivergence != null) {
        // Documented pre-existing divergence: commons.json intentionally
        // does NOT match translation.json here. Pin to the known-intentional
        // literal instead, so drift away from it is still caught.
        expect(commons[key]).toBe(intentionalDivergence.expectedCommonsValue);
        return;
      }

      expect(translation[key]).toBeTypeOf('string');
      expect((translation[key] as string).trim().length).toBeGreaterThan(0);
      expect(commons[key]).toBe(translation[key]);
    });
  });
});
