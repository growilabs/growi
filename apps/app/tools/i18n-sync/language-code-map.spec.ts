import { describe, expect, it } from 'vitest';

import { toPoeditorLanguageCode } from './language-code-map';

describe('toPoeditorLanguageCode', () => {
  it.each([
    ['en_US', 'en-us'],
    ['ja_JP', 'ja'],
    ['zh_CN', 'zh-CN'],
    ['fr_FR', 'fr'],
    ['ko_KR', 'ko'],
  ])('converts %s to %s', (growiLocale, expectedPoeditorLanguage) => {
    expect(toPoeditorLanguageCode(growiLocale)).toBe(expectedPoeditorLanguage);
  });

  it('throws for an undeclared locale', () => {
    expect(() => toPoeditorLanguageCode('de_DE')).toThrow();
  });
});
