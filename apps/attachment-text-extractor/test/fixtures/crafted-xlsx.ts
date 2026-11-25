import { deflateChunks } from './deflate-chunks';
import { editPart, replaceOrThrow } from './ooxml-package';
import { type XlsxSheet, xlsxParts } from './xlsx';
import { buildZip, type ZipEntry } from './zip';

// Workbooks crafted inside the Python service's test_xlsx_split_precheck.py
// and test_xlsx_split.py / runner/test_child_isolation.py.

const MIB = 1024 * 1024;

/** The bare workbook part every cell-count package starts with. */
export const CELL_COUNT_WORKBOOK = 'xl/workbook.xml';
export const CELL_COUNT_SHEET = 'xl/worksheets/sheet1.xml';

/** Sheet parts the cell pre-check must find without following relationships. */
export const NON_STANDARD_SHEET_LOCATIONS: readonly string[] = [
  'xl/worksheets/sub/sheet1.xml',
  'xl/custom/sheet1.xml',
  'xl/worksheets/sheet1.XML',
  'sheet1.xml',
  'xl/worksheets/sheet1.bin',
  'xl/worksheets/sheet1',
];

/** `count` cells in one row, the shape of Python's `_sheet(_cells(count))`. */
export const cellsSheetXml = (count: number): string =>
  `<worksheet xmlns="m"><sheetData><row r="1">${'<c r="A1"><v>1</v></c>'.repeat(count)}</row></sheetData></worksheet>`;

/** `<workbook/>` first, then the given parts as they are. */
export const buildCellCountPackage = (parts: readonly ZipEntry[]): Buffer =>
  buildZip([{ name: CELL_COUNT_WORKBOOK, data: '<workbook/>' }, ...parts]);

/** Sheet 1 encoded as UTF-16 after its byte order mark. */
export const buildUtf16SheetPackage = (
  byteOrder: 'le' | 'be',
  cells: number,
): Buffer => {
  const littleEndian = Buffer.from(cellsSheetXml(cells), 'utf16le');
  const body =
    byteOrder === 'le'
      ? Buffer.concat([Buffer.from([0xff, 0xfe]), littleEndian])
      : Buffer.concat([
          Buffer.from([0xfe, 0xff]),
          Buffer.from(littleEndian).swap16(),
        ]);
  return buildCellCountPackage([{ name: CELL_COUNT_SHEET, data: body }]);
};

/** Sheet 1 twice: first with 1 cell, then with 10. */
export const buildDuplicateSheetPartsPackage = (): Buffer =>
  buildCellCountPackage([
    { name: CELL_COUNT_SHEET, data: cellsSheetXml(1) },
    { name: CELL_COUNT_SHEET, data: cellsSheetXml(10) },
  ]);

/** 20 bytes of 0xff written over sheet 1's deflate stream, 10 bytes in. */
export const buildCorruptSheetStreamPackage = (): Buffer => {
  const zip = buildCellCountPackage([
    { name: CELL_COUNT_SHEET, data: cellsSheetXml(500) },
  ]);
  const name = Buffer.from('worksheets/sheet1.xml');
  const start = zip.indexOf(name) + name.length + 10;
  return Buffer.concat([
    zip.subarray(0, start),
    Buffer.alloc(20, 0xff),
    zip.subarray(start + 20),
  ]);
};

export const DOT_DOT_SHEET_MARKER = 'dotdot marker';

/**
 * A workbook whose only sheet sits at the package root, reached through
 * `Target="../sheet1.xml"` in the workbook relationships: anydoc follows the
 * target, so a cell check that filters parts by path would miss the sheet.
 * Its one row holds the marker and then `1`s, `cells` cells in all.
 */
export const buildDotDotTargetSheetXlsx = (cells: number): Buffer => {
  const row = [
    DOT_DOT_SHEET_MARKER,
    ...Array.from({ length: cells - 1 }, () => 1),
  ];
  const retargeted = editPart(
    xlsxParts([{ name: 'Data', rows: [row] }]),
    'xl/_rels/workbook.xml.rels',
    (rels) =>
      replaceOrThrow(
        rels,
        'Target="worksheets/sheet1.xml"',
        'Target="../sheet1.xml"',
      ),
  );
  const parts = editPart(retargeted, '[Content_Types].xml', (types) =>
    replaceOrThrow(
      types,
      'PartName="/xl/worksheets/sheet1.xml"',
      'PartName="/sheet1.xml"',
    ),
  );
  return buildZip(
    parts.map((part) =>
      part.name === CELL_COUNT_SHEET ? { ...part, name: 'sheet1.xml' } : part,
    ),
  );
};

const TWO_SHEETS: readonly XlsxSheet[] = [
  { name: 'A', rows: [['first copy']] },
  { name: 'B', rows: [['b']] },
];

/** Sheet 1 again at the end, its value changed to `second copy`. */
export const buildDuplicatedEntryXlsx = (): Buffer => {
  const parts = xlsxParts(TWO_SHEETS);
  const sheet1 = parts.find((part) => part.name === CELL_COUNT_SHEET);
  if (sheet1 == null || typeof sheet1.data !== 'string') {
    throw new Error('xlsxParts wrote no sheet 1 text');
  }
  return buildZip([
    ...parts,
    { ...sheet1, data: sheet1.data.replace('first copy', 'second copy') },
  ]);
};

/** Sheets A and B (values `a` and `b`) with every entry stored. */
export const buildStoredEntriesXlsx = (): Buffer =>
  buildZip(
    xlsxParts([
      { name: 'A', rows: [['a']] },
      { name: 'B', rows: [['b']] },
    ]).map((part) => ({ ...part, method: 'stored' as const })),
  );

/**
 * The workbook plus a 150 MiB pivot cache records part of zeros: not a cell,
 * so only a streaming copy keeps it cheap.
 */
export const buildLargePivotCacheXlsx = (
  sheets: readonly XlsxSheet[],
): Buffer => {
  const zeros = Buffer.alloc(MIB);
  return buildZip([
    ...xlsxParts(sheets),
    {
      name: 'xl/pivotCache/pivotCacheRecords1.xml',
      deflated: deflateChunks(Array.from({ length: 150 }, () => zeros)),
    },
  ]);
};

/**
 * Defined names, print titles and a cached cross-sheet formula that name the
 * sheets, as Python's `_stale_reference_book` writes with openpyxl.
 */
export const buildStaleReferenceXlsx = (): Buffer =>
  buildZip(
    xlsxParts(
      [
        {
          name: 'Alpha',
          rows: [
            ['alpha value', { formula: 'Beta!A1', cached: 'cached from beta' }],
          ],
        },
        { name: 'Beta', rows: [['beta value']] },
      ],
      {
        definedNames: [
          { name: 'named_cell', text: 'Beta!$A$1' },
          {
            name: '_xlnm.Print_Titles',
            text: "'Alpha'!$1:$1",
            localSheetId: 0,
          },
        ],
      },
    ),
  );
