import path from 'node:path';
import { AllLang } from '@growi/core';
import { isServer } from '@growi/core/dist/utils';
// These backends are now imported statically at the top level. Each package's
// default export is the backend class itself (verified against their ESM dist /
// .d.ts: `export default class ...`), so the default import IS the constructor —
// no `.default` unwrap is needed (that was a require()-interop artifact).
// Importing them on the server is harmless: none touch window/localStorage at
// module-load time (they guard with `typeof window` or only inside methods).
import ChainedBackend from 'i18next-chained-backend';
import HttpBackend from 'i18next-http-backend';
import LocalStorageBackend from 'i18next-localstorage-backend';

import { defaultLang, initOptions } from './i18next.config.mjs';

const isDev = process.env.NODE_ENV === 'development';
/** @type {import('next-i18next').UserConfig} */
export default {
  ...initOptions,
  i18n: {
    defaultLocale: defaultLang.toString(),
    locales: AllLang,
  },
  localePath: path.resolve('./public/static/locales'),
  serializeConfig: false,
  use: isDev ? (isServer() ? [] : [ChainedBackend]) : [],
  backend: {
    backends: isServer() ? [] : [LocalStorageBackend, HttpBackend],
    backendOptions: [
      // options for i18next-localstorage-backend
      { expirationTime: isDev ? 0 : 24 * 60 * 60 * 1000 }, // 1 day in production
      // options for i18next-http-backend
      { loadPath: '/static/locales/{{lng}}/{{ns}}.json' },
    ],
  },
};
