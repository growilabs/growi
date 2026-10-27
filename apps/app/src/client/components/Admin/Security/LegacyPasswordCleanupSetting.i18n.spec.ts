import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
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
  `${SECTION}.confirm.downgrade_warning`,
  `${SECTION}.confirm.submit`,
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
  `${SECTION}.retry`,
  'audit_log_action.ADMIN_LEGACY_PASSWORD_DELETE',
];

// Called with `{ count }`, so i18next resolves them through the locale's plural
// suffixes (`_one` / `_other`) rather than the bare key.
const PLURAL_KEYS = [`${SECTION}.confirm.warning`, `${SECTION}.success`];

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

  describe.each(LOCALES)('%s plural messages', (locale) => {
    const t = (key: string, count: number): string => {
      const instance = i18next.createInstance();
      instance.init({
        lng: locale.replace('_', '-'),
        initImmediate: false,
        resources: { [locale.replace('_', '-')]: { admin: locales[locale] } },
        ns: ['admin'],
        defaultNS: 'admin',
      });
      return instance.t(key, { count });
    };

    it.each(PLURAL_KEYS)('resolves %s with the count for 1 and 3', (key) => {
      for (const count of [1, 3]) {
        const message = t(key, count);
        expect(message).not.toBe(key);
        expect(message).toContain(String(count));
      }
    });
  });
});
