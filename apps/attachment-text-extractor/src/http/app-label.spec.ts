import type { IncomingHttpHeaders } from 'node:http';

import { appLabelOf } from './app-label';

const headersWith = (value: string | string[] | undefined) =>
  ({ 'x-growi-app-id': value }) satisfies IncomingHttpHeaders;

describe('appLabelOf', () => {
  it('is "-" when the header is absent', () => {
    expect(appLabelOf({})).toBe('-');
    expect(appLabelOf(headersWith(undefined))).toBe('-');
  });

  it.each([
    'a',
    '5f3a9c',
    'app-1.beta_2',
    'A'.repeat(64),
  ])('is the value itself when it has the allowed shape: %s', (value) => {
    expect(appLabelOf(headersWith(value))).toBe(value);
  });

  it.each([
    ['empty', ''],
    ['65 characters', 'a'.repeat(65)],
    ['a leading dot', '.abc'],
    ['a leading hyphen', '-abc'],
    ['a space', 'a b'],
    ['a slash', 'a/b'],
    ['an equals sign', 'a=b'],
    ['a non-ASCII character', 'café'],
    ['a trailing newline', 'abc\n'],
    ['two values joined by Node', 'abc, def'],
  ])('is "(invalid)" for %s, without echoing the value', (_name, value) => {
    expect(appLabelOf(headersWith(value))).toBe('(invalid)');
  });

  it('is "(invalid)" for an array value instead of throwing', () => {
    expect(appLabelOf(headersWith(['a', 'b']))).toBe('(invalid)');
  });
});
