import { AllLang, Lang } from '@growi/core/dist/interfaces';
/** @type {import('@growi/core/dist/interfaces').Lang} */
export const defaultLang = Lang.en_US;
/** @type {import('i18next').InitOptions} */
export const initOptions = {
  fallbackLng: defaultLang.toString(),
  supportedLngs: AllLang,
  defaultNS: 'translation',
};
