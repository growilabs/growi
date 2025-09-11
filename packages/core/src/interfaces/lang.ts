export const Lang = {
  en_US: 'en_US',
  ja_JP: 'ja_JP',
  zh_CN: 'zh_CN',
  fr_FR: 'fr_FR',
  ko_KR: 'ko_KR',
} as const;
export const AllLang = Object.values(Lang);
export type Lang = (typeof Lang)[keyof typeof Lang];
