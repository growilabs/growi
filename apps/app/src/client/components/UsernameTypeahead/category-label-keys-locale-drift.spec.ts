import fs from 'node:fs';
import path from 'node:path';

import { CATEGORY_LABEL_KEYS } from './UsernameTypeahead';

/**
 * Guards the group-header keys against the locale files.
 *
 * The component spec mocks `t` to echo its argument, so it pins the key
 * *string* — including the namespace, which is the load-bearing part (admin
 * pages load ['admin'], the search page loads ['translation'], and `commons` is
 * the only namespace both get). What it cannot see is whether that string
 * resolves: moving the entry to another namespace file, or dropping it, leaves
 * every component test green while the menu renders a raw key.
 *
 * en_US only, on purpose: `fallbackLng` is the default language
 * (config/i18next.config.mjs), so a key missing from ja_JP renders the English
 * text, while one missing from en_US renders the raw key to everyone. The other
 * locales are not at key parity with en_US in general (ko_KR carries roughly
 * half of commons.json), so requiring all five here would enforce a standard
 * the repo does not hold elsewhere.
 */
const readCommonsLocale = (): unknown => {
  const localePath = path.resolve(
    import.meta.dirname,
    '../../../../public/static/locales/en_US/commons.json',
  );
  return JSON.parse(fs.readFileSync(localePath, 'utf-8'));
};

/**
 * Mirrors i18next's own resolution of `t('commons:username_suggestion.x')`:
 * nsSeparator (':') splits off the namespace, and the remainder is walked by
 * keySeparator ('.') — both left at their defaults in
 * config/i18next.config.mjs.
 */
const resolveKey = (namespaceJson: unknown, key: string): unknown => {
  const [namespace, keyPath] = key.split(':');
  expect(namespace).toBe('commons');

  return keyPath.split('.').reduce<unknown>((acc, segment) => {
    if (acc != null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, namespaceJson);
};

describe('username typeahead group-header keys resolve in en_US/commons.json', () => {
  const labelKeys = Object.values(CATEGORY_LABEL_KEYS);
  const commonsLocale = readCommonsLocale();

  // Guards the guard: an emptied or renamed key map would leave the it.each
  // below with no cases and pass vacuously.
  it('reads at least one label key from the component (guards an empty walk)', () => {
    expect(labelKeys.length).toBeGreaterThan(0);
  });

  it.each(
    labelKeys.map((key): [string] => [key]),
  )('%s resolves to a non-empty translated string', (key) => {
    const value = resolveKey(commonsLocale, key);
    expect(typeof value).toBe('string');
    expect((value as string).length).toBeGreaterThan(0);
  });
});
