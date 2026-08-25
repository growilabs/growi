import fs from 'node:fs';
import path from 'node:path';
import { AllLang, type Lang } from '@growi/core';

import nextI18NextConfig from '^/config/next-i18next.config.mjs';

export type LangDisplayNames = Readonly<Partial<Record<Lang, string>>>;

let cache: LangDisplayNames | undefined;

// Reads only `meta.display_name` from the smallest namespace (commons) for every
// supported language, instead of preloading every namespace for every language
// into the client bundle (the `preloadAllLang` approach this replaces).
export const getLangDisplayNames = (): LangDisplayNames => {
  if (cache != null) {
    return cache;
  }

  const { localePath } = nextI18NextConfig;
  if (typeof localePath !== 'string') {
    // next-i18next's UserConfig type also allows a per-namespace function, but
    // this project's config always sets a static path.resolve(...) string.
    throw new Error('next-i18next config localePath must be a string path');
  }

  cache = Object.fromEntries(
    AllLang.map((lang) => {
      const filePath = path.join(localePath, lang, 'commons.json');
      const commons = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return [lang, commons.meta.display_name];
    }),
  );

  return cache;
};
