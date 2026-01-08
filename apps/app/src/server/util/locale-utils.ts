import { Lang } from '@growi/core/dist/interfaces';
import { enUS, fr, ja, ko, type Locale, zhCN } from 'date-fns/locale';
import type { IncomingHttpHeaders } from 'http';

import * as i18nextConfig from '^/config/i18next.config';

const ACCEPT_LANG_MAP = {
  en: Lang.en_US,
  ja: Lang.ja_JP,
  zh: Lang.zh_CN,
  fr: Lang.fr_FR,
  ko: Lang.ko_KR,
};

const DATE_FNS_LOCALE_MAP: Record<string, Locale | undefined> = {
  en: enUS,
  'en-US': enUS,
  en_US: enUS,

  ja: ja,
  'ja-JP': ja,
  ja_JP: ja,

  fr: fr,
  'fr-FR': fr,
  fr_FR: fr,

  ko: ko,
  'ko-KR': ko,
  ko_KR: ko,

  zh: zhCN,
  'zh-CN': zhCN,
  zh_CN: zhCN,
};

/**
 * Gets the corresponding date-fns Locale object from an i18next language code.
 * @param langCode The i18n language code (e.g., 'ja_JP').
 * @returns The date-fns Locale object, defaulting to enUS if not found.
 */
export const getLocale = (langCode: string): Locale => {
  let locale = DATE_FNS_LOCALE_MAP[langCode];

  if (!locale) {
    const baseCode = langCode.split(/[-_]/)[0];
    locale = DATE_FNS_LOCALE_MAP[baseCode];
  }

  return locale ?? enUS;
};

/**
 * It return the first language that matches ACCEPT_LANG_MAP keys from sorted accept languages array
 * @param sortedAcceptLanguagesArray
 */
const getPreferredLanguage = (sortedAcceptLanguagesArray: string[]): Lang => {
  for (const lang of sortedAcceptLanguagesArray) {
    const matchingLang = Object.keys(ACCEPT_LANG_MAP).find((key) =>
      lang.includes(key),
    );
    if (matchingLang) return ACCEPT_LANG_MAP[matchingLang];
  }
  return i18nextConfig.defaultLang;
};

/**
 * Detect locale from browser accept language
 * @param headers
 */
export const detectLocaleFromBrowserAcceptLanguage = (
  headers: IncomingHttpHeaders,
): Lang => {
  // 1. get the header accept-language
  // ex. "ja,ar-SA;q=0.8,en;q=0.6,en-CA;q=0.4,en-US;q=0.2"
  const acceptLanguages = headers['accept-language'];

  if (acceptLanguages == null) {
    return i18nextConfig.defaultLang;
  }

  // 1. trim blank spaces.
  // 2. separate by ,.
  // 3. if "lang;q=x", then { 'x', 'lang' } to add to the associative array.
  //    if "lang" has no weight x (";q=x"), add it with key = 1.
  // ex. {'1': 'ja','0.8': 'ar-SA','0.6': 'en','0.4': 'en-CA','0.2': 'en-US'}
  const acceptLanguagesDict = acceptLanguages
    .replace(/\s+/g, '')
    .split(',')
    .map((item) => item.split(/\s*;\s*q\s*=\s*/))
    .reduce((acc, [key, value = '1']) => {
      acc[value] = key;
      return acc;
    }, {});

  // 1. create an array of sorted languages in descending order.
  // ex. [ 'ja', 'ar-SA', 'en', 'en-CA', 'en-US' ]
  const sortedAcceptLanguagesArray = Object.keys(acceptLanguagesDict)
    .sort((x, y) => y.localeCompare(x))
    .map((item) => acceptLanguagesDict[item]);

  return getPreferredLanguage(sortedAcceptLanguagesArray);
};
