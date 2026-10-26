import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en_US', 'ja_JP', 'fr_FR', 'ko_KR', 'zh_CN'] as const;

const SECTION = 'security_settings.legacy_password_cleanup';

const REQUIRED_KEYS = [
  `${SECTION}.title`,
  `${SECTION}.description`,
  `${SECTION}.count_label.upgraded_only`,
  `${SECTION}.count_label.both`,
  `${SECTION}.count_label.legacy_only`,
  `${SECTION}.count_label.legacy_only_active`,
  `${SECTION}.count_label.legacy_only_non_active`,
  `${SECTION}.count_label.no_password`,
  `${SECTION}.both_is_target_hint`,
  `${SECTION}.delete_button`,
  `${SECTION}.confirm.title`,
  `${SECTION}.confirm.warning`,
  `${SECTION}.confirm.downgrade_warning`,
  `${SECTION}.confirm.submit`,
  `${SECTION}.success`,
  `${SECTION}.delete_error`,
  `${SECTION}.fetch_error`,
  `${SECTION}.unmigrated_list.title`,
  `${SECTION}.unmigrated_list.description`,
  `${SECTION}.unmigrated_list.column.username`,
  `${SECTION}.unmigrated_list.column.email`,
  `${SECTION}.unmigrated_list.column.last_login`,
  `${SECTION}.unmigrated_list.never_logged_in`,
  `${SECTION}.unmigrated_list.empty`,
  `${SECTION}.unmigrated_list.fetch_error`,
  'audit_log_action.ADMIN_LEGACY_PASSWORD_DELETE',
];

// Keys whose en_US text carries an interpolation placeholder
const KEYS_WITH_COUNT_PLACEHOLDER = [
  `${SECTION}.confirm.warning`,
  `${SECTION}.success`,
];

const LOCALE_BASE = join(__dirname, '../../../../../public/static/locales');

const loadAdminLocale = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(LOCALE_BASE, locale, 'admin.json'), 'utf-8'));

const getNestedValue = (obj: Record<string, unknown>, dotPath: string) =>
  dotPath.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);

const locales = Object.fromEntries(
  LOCALES.map((locale) => [locale, loadAdminLocale(locale)]),
);

describe('LegacyPasswordCleanupSetting i18n (admin.json)', () => {
  describe.each(LOCALES)('%s', (locale) => {
    it.each(REQUIRED_KEYS)('has a non-empty string for %s', (key) => {
      const value = getNestedValue(locales[locale], key);
      expect(typeof value).toBe('string');
      expect((value as string).trim()).not.toBe('');
    });
  });

  it.each(
    KEYS_WITH_COUNT_PLACEHOLDER,
  )('en_US %s contains the {{count}} placeholder', (key) => {
    expect(getNestedValue(locales.en_US, key)).toContain('{{count}}');
  });

  describe.each(
    LOCALES.filter((l) => l !== 'en_US'),
  )('%s placeholders', (locale) => {
    it.each(
      KEYS_WITH_COUNT_PLACEHOLDER,
    )('keeps the {{count}} placeholder of %s', (key) => {
      expect(getNestedValue(locales[locale], key)).toContain('{{count}}');
    });
  });
});
