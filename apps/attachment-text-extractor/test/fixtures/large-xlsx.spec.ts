import {
  buildLargeForTimeoutXlsx,
  buildOneSheetAtCellLimitXlsx,
  buildOneSheetOverCellLimitXlsx,
  buildOverCellLimitXlsx,
  buildXlsxCells,
} from './large-xlsx';
import { anydocMarkdown, readZipEntries, readZipText } from './spec-support';

const LARGE_BUILD_TIMEOUT_MS = 30_000;

const sheetNames = (xlsx: Buffer): string[] =>
  [
    ...readZipText(xlsx, 'xl/workbook.xml').matchAll(
      /<sheet\b[^>]*\bname="([^"]*)"/g,
    ),
  ].map((match) => match[1]);

const cellCounts = (xlsx: Buffer): number[] =>
  [...readZipEntries(xlsx)]
    .filter(([name]) => name.startsWith('xl/worksheets/'))
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([, data]) => data.toString('utf8').match(/<c\b/g)?.length ?? 0);

describe('buildXlsxCells', () => {
  it('fills every cell with its 0-based position, as write_xlsx_cells does', async () => {
    const xlsx = buildXlsxCells([
      { name: 'First', rows: 2, cols: 3 },
      { name: 'Last', rows: 1, cols: 2 },
    ]);

    const markdown = await anydocMarkdown(xlsx, 'xlsx');

    expect(sheetNames(xlsx)).toEqual(['First', 'Last']);
    expect(cellCounts(xlsx)).toEqual([6, 2]);
    expect(markdown).toContain('| r0c0 | r0c1 | r0c2 |');
    expect(markdown).toContain('| r1c0 | r1c1 | r1c2 |');
    expect(markdown).toContain('| r0c0 | r0c1 |');
  });

  it('adds a tail row only to the last sheet', () => {
    const xlsx = buildXlsxCells(
      [
        { name: 'A', rows: 1, cols: 1 },
        { name: 'B', rows: 1, cols: 1 },
      ],
      3,
    );

    expect(cellCounts(xlsx)).toEqual([1, 4]);
    expect(readZipText(xlsx, 'xl/worksheets/sheet2.xml')).toContain(
      '<t>tail2</t>',
    );
  });
});

describe('cell-limit workbooks', () => {
  it(
    'puts exactly 70,001 cells in one sheet named Big for the over-limit workbook',
    () => {
      const xlsx = buildOverCellLimitXlsx();

      expect(sheetNames(xlsx)).toEqual(['Big']);
      expect(cellCounts(xlsx)).toEqual([70_001]);
    },
    LARGE_BUILD_TIMEOUT_MS,
  );

  it(
    'spreads exactly 70,000 cells over five sheets of 14,000 rows for the timeout workbook',
    () => {
      const xlsx = buildLargeForTimeoutXlsx();

      expect(sheetNames(xlsx)).toEqual([
        'Sheet1',
        'Sheet2',
        'Sheet3',
        'Sheet4',
        'Sheet5',
      ]);
      expect(cellCounts(xlsx)).toEqual([
        14_000, 14_000, 14_000, 14_000, 14_000,
      ]);
    },
    LARGE_BUILD_TIMEOUT_MS,
  );

  it(
    'puts 70,000 cells in one Data column at the limit and one more cell over it',
    () => {
      expect(cellCounts(buildOneSheetAtCellLimitXlsx())).toEqual([70_000]);
      const over = buildOneSheetOverCellLimitXlsx();
      expect(sheetNames(over)).toEqual(['Data']);
      expect(cellCounts(over)).toEqual([70_001]);
    },
    LARGE_BUILD_TIMEOUT_MS,
  );
});
