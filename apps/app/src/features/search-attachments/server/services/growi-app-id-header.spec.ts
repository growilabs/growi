import { describe, expect, it } from 'vitest';

import { toGrowiAppIdHeaderValue } from './growi-app-id-header';

describe('toGrowiAppIdHeaderValue', () => {
  it('returns a string value as is', () => {
    expect(toGrowiAppIdHeaderValue('4242')).toBe('4242');
  });

  it('turns a number into a string', () => {
    expect(toGrowiAppIdHeaderValue(4242)).toBe('4242');
  });

  it('accepts every printable ASCII character from 0x21 to 0x7E', () => {
    const all = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) =>
      String.fromCharCode(0x21 + i),
    ).join('');
    expect(toGrowiAppIdHeaderValue(all)).toBe(all);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['a value with an inner space', 'a b'],
    ['a value with a leading space', ' 4242'],
    ['a value with a trailing space', '4242 '],
    ['a value with a trailing newline', '4242\n'],
    ['a value with an inner newline', 'a\nb'],
    ['a value with a carriage return', 'a\rb'],
    ['a value with a tab', 'a\tb'],
    ['a value with a non-ASCII character', '日本'],
    ['a value with DEL (0x7F)', 'a\x7fb'],
  ])('returns undefined for %s', (_label, value) => {
    expect(toGrowiAppIdHeaderValue(value)).toBeUndefined();
  });
});
