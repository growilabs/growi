const { Lang, AllLang } = require('@growi/core/dist/interfaces');

/** @type {import('@growi/core/dist/interfaces').Lang} */
const defaultLang = Lang.en_US;

/** @type {import('i18next').InitOptions} */
const initOptions = {
  fallbackLng: defaultLang.toString(),
  supportedLngs: AllLang,
  defaultNS: 'translation',
};

exports.defaultLang = defaultLang;
exports.initOptions = initOptions;
