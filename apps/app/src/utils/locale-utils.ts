import type { Locale } from 'date-fns/locale';
import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import { ja } from 'date-fns/locale/ja';
import { ko } from 'date-fns/locale/ko';
import { zhCN } from 'date-fns/locale/zh-CN';

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
