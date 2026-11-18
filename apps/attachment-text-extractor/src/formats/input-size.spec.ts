import { resolveFormat } from './format-table';
import { checkInputSize, type InputSizeViolation } from './input-size';

const CSV_CAP = 100;
const HTML_CAP = 200;

const LIMITS = { maxCsvBytes: CSV_CAP, maxHtmlBytes: HTML_CAP };

const check = (
  fileName: string,
  size: number,
  mimeHint: string | null = null,
): InputSizeViolation | null => {
  const format = resolveFormat(fileName, mimeHint);
  if (format == null) {
    throw new Error(`expected ${fileName} / ${mimeHint} to be supported`);
  }
  return checkInputSize(format, size, LIMITS);
};

const CAPPED: readonly (readonly [string, string | null, number])[] = [
  ['a.csv', null, CSV_CAP],
  ['a.tsv', null, CSV_CAP],
  ['a.html', null, HTML_CAP],
  ['a.htm', null, HTML_CAP],
  ['noext', 'text/csv', CSV_CAP],
  ['noext', 'text/tab-separated-values', CSV_CAP],
  ['noext', 'text/html; charset=utf-8', HTML_CAP],
];

describe('checkInputSize', () => {
  it.each(
    CAPPED,
  )('passes %s (MIME %j) at exactly its cap of %i bytes', (fileName, mime, cap) => {
    expect(check(fileName, cap, mime)).toBeNull();
  });

  it.each(
    CAPPED,
  )('reports %s (MIME %j) one byte over its cap of %i bytes as limit_exceeded', (fileName, mime, cap) => {
    expect(check(fileName, cap + 1, mime)).toMatchObject({
      failure: 'limit_exceeded',
    });
  });

  it.each([
    'a.xml',
    'a.ipynb',
    'a.txt',
    'a.md',
    'a.json',
    'a.yaml',
    'a.pdf',
    'a.docx',
    'a.xlsx',
    'a.pptx',
    'a.xls',
  ])('has no input size cap for %s', (fileName) => {
    expect(check(fileName, 10 ** 12)).toBeNull();
  });

  it('applies the cap of the format the MIME hint decides, not the extension', () => {
    expect(check('a.txt', CSV_CAP + 1, 'text/csv')).toMatchObject({
      failure: 'limit_exceeded',
    });
    expect(check('a.csv', CSV_CAP + 1, 'text/plain')).toBeNull();
  });

  it('never puts the size or the file name into the detail', () => {
    const violation = check('SECRET-NAME.csv', CSV_CAP + 1);

    expect(violation).not.toBeNull();
    expect(violation?.detail).not.toContain('SECRET-NAME');
    expect(violation?.detail).not.toContain(String(CSV_CAP + 1));
  });
});
