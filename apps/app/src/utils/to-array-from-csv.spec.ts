import { toArrayFromCsv } from './to-array-from-csv';

describe('To array from csv', () => {
  test('case 1', () => {
    const result = toArrayFromCsv('dev,general');
    expect(result).toStrictEqual(['dev', 'general']);
  });

  test('case 2', () => {
    const result = toArrayFromCsv('dev');
    expect(result).toStrictEqual(['dev']);
  });

  test('case 3', () => {
    const result = toArrayFromCsv('');
    expect(result).toStrictEqual([]);
  });

  test('case 4', () => {
    const result = toArrayFromCsv('dev, general');
    expect(result).toStrictEqual(['dev', 'general']);
  });

  test('case 5', () => {
    const result = toArrayFromCsv(',dev,general');
    expect(result).toStrictEqual(['dev', 'general']);
  });
});
