import { enUS } from 'date-fns/locale/en-US';
import { fr } from 'date-fns/locale/fr';
import { ja } from 'date-fns/locale/ja';
import { ko } from 'date-fns/locale/ko';
import { zhCN } from 'date-fns/locale/zh-CN';
import { describe, expect, it } from 'vitest';

import { getLocale } from './locale-utils';

describe('getLocale', () => {
  it.each([
    // Base codes
    ['en', enUS],
    ['ja', ja],
    ['fr', fr],
    ['ko', ko],
    ['zh', zhCN],
    // Hyphenated variants
    ['en-US', enUS],
    ['ja-JP', ja],
    ['fr-FR', fr],
    ['ko-KR', ko],
    ['zh-CN', zhCN],
    // Underscore variants
    ['en_US', enUS],
    ['ja_JP', ja],
    ['fr_FR', fr],
    ['ko_KR', ko],
    ['zh_CN', zhCN],
  ])('should return the correct locale for "%s"', (langCode, expected) => {
    expect(getLocale(langCode)).toBe(expected);
  });

  it('should fall back to base code when hyphenated variant is unknown', () => {
    expect(getLocale('en-GB')).toBe(enUS);
  });

  it('should default to enUS for unknown locale', () => {
    expect(getLocale('unknown')).toBe(enUS);
  });

  it('should default to enUS for empty string', () => {
    expect(getLocale('')).toBe(enUS);
  });
});
