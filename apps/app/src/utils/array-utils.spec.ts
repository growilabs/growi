import { chunk } from './array-utils';

describe('chunk', () => {
  test('should split items into consecutive groups of the given size', () => {
    expect(chunk(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e'],
    ]);
  });

  test('should return a single group when the items fit in one', () => {
    expect(chunk(['a', 'b'], 5)).toEqual([['a', 'b']]);
  });

  test('should not leave a trailing empty group when the size divides the length', () => {
    expect(chunk(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  test('should return no groups for no items', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  test('should not modify the input', () => {
    const items = ['a', 'b', 'c'];

    chunk(items, 2);

    expect(items).toEqual(['a', 'b', 'c']);
  });

  test.each([
    0,
    -1,
    1.5,
    Number.NaN,
  ])('should reject a size of %s rather than loop or drop items', (size) => {
    expect(() => chunk(['a'], size)).toThrow(RangeError);
  });
});
