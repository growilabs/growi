const isDev = process.env.NODE_ENV === 'development';

const path = require('path');

const { AllLang } = require('@growi/core');
const { isServer } = require('@growi/core/dist/utils');

const { defaultLang } = require('./i18next.config');

const HMRPlugin = isDev ? require('i18next-hmr/plugin').HMRPlugin : undefined;

/** @type {import('next-i18next').UserConfig} */
module.exports = {
  ...require('./i18next.config').initOptions,

  i18n: {
    defaultLocale: defaultLang.toString(),
    locales: AllLang,
  },

  localePath: path.resolve('./public/static/locales'),
  serializeConfig: false,

  // eslint-disable-next-line no-nested-ternary
  use: isDev
    ? isServer()
      ? [new HMRPlugin({ webpack: { server: true } })]
      : [
          require('i18next-chained-backend').default,
          new HMRPlugin({ webpack: { client: true } }),
        ]
    : [],
  backend: {
    backends: isServer()
      ? []
      : [
          require('i18next-localstorage-backend').default,
          require('i18next-http-backend').default,
        ],
    backendOptions: [
      // options for i18next-localstorage-backend
      { expirationTime: isDev ? 0 : 24 * 60 * 60 * 1000 }, // 1 day in production
      // options for i18next-http-backend
      { loadPath: '/static/locales/{{lng}}/{{ns}}.json' },
    ],
  },
};
