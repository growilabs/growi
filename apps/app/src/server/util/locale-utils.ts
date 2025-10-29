
import type { IncomingHttpHeaders } from 'http';
import { promises as fsPromises, constants as fsConstants } from 'fs';
import path from 'path';

import { Lang, AllLang } from '@growi/core/dist/interfaces';

import * as i18nextConfig from '^/config/i18next.config';

const ACCEPT_LANG_MAP = {
  en: Lang.en_US,
  ja: Lang.ja_JP,
  zh: Lang.zh_CN,
  fr: Lang.fr_FR,
  ko: Lang.ko_KR,
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

const ALLOWED_LANG_SET = new Set<Lang>(AllLang);

const normalizeLocaleId = (value: string): string => value.replace(/-/g, '_');

type ResolveTemplateOptions = {
  baseDir: string;
  locale?: string;
  templateSegments: string[];
  fallbackLocale?: Lang;
};

const isPathInsideBase = (basePath: string, targetPath: string): boolean => {
  const relative = path.relative(basePath, targetPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const doesTemplateExist = async(candidatePath: string, baseDir: string): Promise<boolean> => {
  const resolvedBase = path.resolve(baseDir);

  if (!isPathInsideBase(resolvedBase, candidatePath)) {
    return false;
  }

  try {
    await fsPromises.access(candidatePath, fsConstants.F_OK);
    return true;
  }
  catch {
    return false;
  }
};

// Collects candidate template paths ordered by preferred and fallback locales.
const templatePathCandidates = (
    sanitizedLocale: Lang | undefined,
    fallbackLocale: Lang,
    baseDir: string,
    segments: string[],
): string[] => {
  const resolvedBase = path.resolve(baseDir);
  const locales = new Set<Lang>();
  if (sanitizedLocale != null) {
    locales.add(sanitizedLocale);
  }
  locales.add(fallbackLocale);

  return Array.from(locales).map(locale => path.resolve(resolvedBase, locale, ...segments));
};

// Guard functions that collapse to undefined or default values for further processing.
export const coerceToSupportedLang = (
    value: unknown,
    { fallback = i18nextConfig.defaultLang, allowUndefined = false }: { fallback?: Lang; allowUndefined?: boolean } = {},
): Lang | undefined => {
  if (typeof value !== 'string') {
    return allowUndefined ? undefined : fallback;
  }

  const normalized = normalizeLocaleId(value);
  if (ALLOWED_LANG_SET.has(normalized as Lang)) {
    return normalized as Lang;
  }

  return allowUndefined ? undefined : fallback;
};

export const resolveLocaleTemplatePath = async({
  baseDir,
  locale,
  templateSegments,
  fallbackLocale = Lang.en_US,
}: ResolveTemplateOptions): Promise<string> => {
  const sanitizedLocale = coerceToSupportedLang(locale, { fallback: fallbackLocale, allowUndefined: true });

  const candidates = templatePathCandidates(sanitizedLocale, fallbackLocale, baseDir, templateSegments);

  for (const candidate of candidates) {
    // sequential check is intentional to stop at first hit
    // eslint-disable-next-line no-await-in-loop
    const exists = await doesTemplateExist(candidate, baseDir);
    if (exists) {
      return candidate;
    }
  }

  throw new Error(
    `Mail template is not available for locale "${locale ?? 'undefined'}" under ${baseDir} with segments ${templateSegments.join('/')}`,
  );
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
