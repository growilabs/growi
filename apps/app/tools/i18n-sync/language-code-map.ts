/**
 * Maps GROWI locale codes to the language codes POEditor's API accepts.
 *
 * Pure function, no I/O — applied only immediately before a `PoeditorClient`
 * call in `PushSourceSync`/`PullTranslationSync`; file-path resolution and
 * namespace handling elsewhere continue to use GROWI locale codes as-is.
 */

export const GROWI_TO_POEDITOR_LANGUAGE: Readonly<Record<string, string>> = {
  en_US: 'en-us',
  ja_JP: 'ja',
  zh_CN: 'zh-CN',
  fr_FR: 'fr',
  ko_KR: 'ko',
};

/**
 * Converts a GROWI locale code to its POEditor language code.
 *
 * Throws for an undeclared locale rather than silently falling back, because
 * an unmapped locale reaching a POEditor API call is a caller misconfiguration
 * that must not be swallowed at runtime.
 */
export const toPoeditorLanguageCode = (growiLocale: string): string => {
  const poeditorLanguage = GROWI_TO_POEDITOR_LANGUAGE[growiLocale];

  if (poeditorLanguage == null) {
    throw new Error(
      `Unsupported GROWI locale for POEditor sync: '${growiLocale}'`,
    );
  }

  return poeditorLanguage;
};
