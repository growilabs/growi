import { parsePageQuery } from './parse-page-query';

describe('parsePageQuery', () => {
  test('parses a valid positive integer', () => {
    expect(parsePageQuery('3')).toBe(3);
  });

  test.each([
    ['missing value', undefined],
    ['non-numeric string', 'abc'],
    ['zero', '0'],
    ['negative number', '-1'],
    ['Infinity', 'Infinity'],
    ['empty string array', [] as string[]],
  ])('falls back to 1 for %s', (_label, input) => {
    expect(parsePageQuery(input)).toBe(1);
  });

  // Note: Number('') === 0, so an empty string also falls back to 1.
  test('falls back to 1 for an empty string', () => {
    expect(parsePageQuery('')).toBe(1);
  });

  test('floors a fractional value', () => {
    expect(parsePageQuery('2.7')).toBe(2);
  });

  test('uses the first element of an array value', () => {
    expect(parsePageQuery(['3', '4'])).toBe(3);
  });
});
