import { createHash } from 'node:crypto';

import {
  JAPANESE_SAMPLE,
  PLAIN_DOCUMENTS,
  type PlainDocumentKey,
} from './documents';
import { anydocErrorCode, anydocMarkdown, readZipText } from './spec-support';

const build = (key: PlainDocumentKey): Buffer => PLAIN_DOCUMENTS[key].build();
const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

const workbookSheets = (xlsx: Buffer): string[] =>
  readZipText(xlsx, 'xl/workbook.xml').match(/<sheet\b[^>]*\/>/g) ?? [];

describe('PLAIN_DOCUMENTS', () => {
  // Expected Markdown is what Python anydoc returns for the files that the
  // Python service's tests/fixture_files.py builds (recorded 2026-11-04).
  it.each<[PlainDocumentKey, string, string]>([
    [
      'xlsxMultiSheet',
      'xlsx',
      '## 売上\n\n| 商品 | 数量 |\n| --- | --- |\n| りんご | 3 |\n| みかん | 5 |\n\n' +
        '## Summary <#1>\n\n|  |  |\n| --- | --- |\n| Total | 8 |\n',
    ],
    ['xlsxSingleSheet', 'xlsx', '|  |\n| --- |\n| single sheet marker |\n'],
    ['xlsxHiddenSheet', 'xlsx', '|  |\n| --- |\n| visible marker |\n'],
    [
      'xlsxChartSheet',
      'xlsx',
      '## Data\n\n| Month | Sales |\n| --- | --- |\n| Jan | 10 |\n| Feb | 20 |\n| Mar | 30 |\n',
    ],
    [
      'pptxMultiSlide',
      'pptx',
      '## Slide One\n\n- first slide body\n\n## Slide Two\n\n- second slide body\n\n' +
        '## Slide Three\n\n- third slide body\n',
    ],
    ['pdfText', 'pdf', '## PDF page 1\n\n## PDF page 2\n\n## PDF page 3\n'],
    ['odt', 'odt', '# 見出し\n\nOpenDocument text marker\n'],
    [
      'ods',
      'ods',
      '## First\n\n|  |\n| --- |\n| OpenDocument sheet marker |\n\n' +
        '## Second\n\n|  |\n| --- |\n| second sheet |\n',
    ],
    ['odp', 'odp', 'OpenDocument slide marker\n'],
    ['epub', 'epub', '# Fixture Book\n\n# 第一章\n\nEPUB chapter marker\n'],
    [
      'rtf',
      'rtf',
      'RTF body marker\n\n障害対応メモ\n\n本番環境で発生した情報システムの障害\n',
    ],
    [
      'xls',
      'xlsx',
      '## First\n\n|  |  |\n| --- | --- |\n| XLS cell marker | 42 |\n\n' +
        '## Second\n\n|  |\n| --- |\n| second sheet |\n',
    ],
  ])('%s converts to the same Markdown as the Python fixture', async (key, extension, markdown) => {
    expect(await anydocMarkdown(build(key), extension)).toBe(markdown);
  });

  it('xlsxMultiSheet keeps the empty third sheet', () => {
    expect(workbookSheets(build('xlsxMultiSheet'))).toHaveLength(3);
    expect(workbookSheets(build('xlsxMultiSheet'))[2]).toContain(
      'name="Empty"',
    );
  });

  it('xlsxSingleSheet has exactly one sheet', () => {
    expect(workbookSheets(build('xlsxSingleSheet'))).toHaveLength(1);
  });

  it('xlsxHiddenSheet hides the second sheet', () => {
    const sheets = workbookSheets(build('xlsxHiddenSheet'));

    expect(sheets).toHaveLength(2);
    expect(sheets[1]).toMatch(/name="Secret"[^>]*state="hidden"/);
  });

  it('xlsxChartSheet has a worksheet and a chart-only sheet', () => {
    const xlsx = build('xlsxChartSheet');

    expect(workbookSheets(xlsx)).toHaveLength(2);
    expect(readZipText(xlsx, 'xl/_rels/workbook.xml.rels')).toContain(
      'Target="chartsheets/sheet1.xml"',
    );
  });

  it('pdfImageOnly is a PDF that needs OCR', async () => {
    expect(await anydocErrorCode(build('pdfImageOnly'), 'pdf')).toBe(
      'needsOcr',
    );
  });

  it.each<[PlainDocumentKey, string]>([
    ['textShiftJis', 'shift_jis'],
    ['textEucJp', 'euc-jp'],
    ['textUtf8Bom', 'utf-8'],
  ])('%s decodes (%s) to the Japanese sample', (key, label) => {
    expect(new TextDecoder(label).decode(build(key))).toBe(JAPANESE_SAMPLE);
  });

  // Expected digests are of the bytes tests/fixture_files.py writes: these
  // formats are ported verbatim, so the files are identical.
  it.each<[PlainDocumentKey, string]>([
    [
      'pdfText',
      '713c3de419961783386516f42aeef7c38bfeba93f3e7269391c365192807b823',
    ],
    [
      'pdfImageOnly',
      '07b30a6a84e320cd8e0acf7e5618b97c4c355e29047bccf3987b7f6b7e166727',
    ],
    ['rtf', '0391384d1f89ec2a43c7b341c9d87e0b23fa711322f8b3dfd2fd1e38fbd5e662'],
  ])('%s is byte-identical to the Python fixture', (key, digest) => {
    expect(sha256(build(key))).toBe(digest);
  });

  it('gives every document its own file name', () => {
    const names = Object.values(PLAIN_DOCUMENTS).map((doc) => doc.fileName);

    expect(new Set(names).size).toBe(names.length);
  });
});
