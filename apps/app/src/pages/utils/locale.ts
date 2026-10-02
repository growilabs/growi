import type { Locale } from '@growi/core';
import { Lang } from '@growi/core';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import { detectLocaleFromBrowserAcceptLanguage } from '~/server/util/locale-utils';

export type LangMap = {
  readonly [key in Lang]: Locale;
};

export const langMap: LangMap = {
  [Lang.ja_JP]: 'ja-JP',
  [Lang.en_US]: 'en-US',
  [Lang.zh_CN]: 'zh-CN',
  [Lang.fr_FR]: 'fr-FR',
  [Lang.ko_KR]: 'ko-KR',
} as const;

// use this function to translate content
export const getLangAtServerSide = (req: CrowiRequest): Lang => {
  const { user, headers } = req;
  const { configManager } = req.crowi;

  return user == null
    ? detectLocaleFromBrowserAcceptLanguage(headers)
    : (user.lang ??
        configManager.getConfig('app:globalLang') ??
        Lang.en_US ??
        Lang.en_US);
};

// use this function to get locale for html lang attribute
export const getLocaleAtServerSide = (req: CrowiRequest): Locale => {
  return langMap[getLangAtServerSide(req)];
};
