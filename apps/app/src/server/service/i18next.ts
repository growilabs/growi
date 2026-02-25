import type { Lang } from '@growi/core';
import type { InitOptions, i18n, TFunction } from 'i18next';
import { createInstance } from 'i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import path from 'path';

import * as i18nextConfig from '^/config/i18next.config';

import { resolveFromRoot } from '~/server/util/project-dir-utils';

import { configManager } from './config-manager';

const relativePathToLocalesRoot = path.relative(
  __dirname,
  resolveFromRoot('public/static/locales'),
);

const initI18next = async (overwriteOpts: InitOptions) => {
  const i18nInstance = createInstance();
  await i18nInstance
    .use(
      resourcesToBackend((language: string, namespace: string) => {
        return import(
          path.join(relativePathToLocalesRoot, language, `${namespace}.json`)
        );
      }),
    )
    .init({
      ...i18nextConfig.initOptions,
      ...overwriteOpts,
    });
  return i18nInstance;
};

type Translation = {
  t: TFunction;
  i18n: i18n;
};

type Opts = {
  lang?: Lang;
  ns?: string | readonly string[];
};

export async function getTranslation(opts?: Opts): Promise<Translation> {
  const globalLang = configManager.getConfig('app:globalLang');
  const fixedLang = opts?.lang ?? globalLang;

  const initOptions: InitOptions = {
    fallbackLng: [fixedLang, i18nextConfig.defaultLang],
  };

  // set ns if not null
  // cz: 'ns: unefined' causes
  //   TypeError: Cannot read properties of undefined (reading 'forEach')
  //     at /workspace/growi/node_modules/.pnpm/i18next@23.16.5/node_modules/i18next/dist/cjs/i18next.js:1613:18"
  if (opts?.ns != null) {
    initOptions.ns = opts.ns;
  }

  const i18nextInstance = await initI18next(initOptions);

  return {
    t: i18nextInstance.getFixedT(fixedLang, opts?.ns),
    i18n: i18nextInstance,
  };
}
