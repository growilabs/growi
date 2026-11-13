import { inflateRawSync } from 'node:zlib';

import {
  buildCellCountPackage,
  buildCorruptSheetStreamPackage,
  buildDotDotTargetSheetXlsx,
  buildDuplicatedEntryXlsx,
  buildDuplicateSheetPartsPackage,
  buildLargePivotCacheXlsx,
  buildStaleReferenceXlsx,
  buildStoredEntriesXlsx,
  buildUtf16SheetPackage,
  CELL_COUNT_SHEET,
  CELL_COUNT_WORKBOOK,
  cellsSheetXml,
  DOT_DOT_SHEET_MARKER,
  NON_STANDARD_SHEET_LOCATIONS,
} from './crafted-xlsx';
import {
  anydocMarkdown,
  type RawZipEntry,
  readLocalBody,
  readZipDirectory,
} from './spec-support';

const MIB = 1024 * 1024;

const directoryOf = (zip: Buffer): RawZipEntry[] => {
  const entries = readZipDirectory(zip);
  if (entries == null) {
    throw new Error('no central directory');
  }
  return entries;
};

const texts = (zip: Buffer, name: string): string[] =>
  directoryOf(zip)
    .filter((entry) => entry.name === name)
    .map((entry) => {
      const body = readLocalBody(zip, entry);
      return (entry.method === 0 ? body : inflateRawSync(body)).toString(
        'utf8',
      );
    });

const cellTags = (xml: string): number => xml.match(/<c\b/g)?.length ?? 0;

describe('cell-count packages (the cell pre-check inputs)', () => {
  it('writes N cells in one row, in the shape the Python pre-check tests use', () => {
    const xml = cellsSheetXml(150);

    expect(cellTags(xml)).toBe(150);
    expect(xml.startsWith('<worksheet xmlns="m"><sheetData><row r="1">')).toBe(
      true,
    );
  });

  it.each(
    NON_STANDARD_SHEET_LOCATIONS,
  )('puts a 150-cell sheet at %s next to a bare workbook', (location) => {
    const zip = buildCellCountPackage([
      { name: location, data: cellsSheetXml(150) },
    ]);

    expect(directoryOf(zip).map((entry) => entry.name)).toEqual([
      CELL_COUNT_WORKBOOK,
      location,
    ]);
    expect(texts(zip, CELL_COUNT_WORKBOOK)).toEqual(['<workbook/>']);
    expect(cellTags(texts(zip, location)[0])).toBe(150);
  });

  it('covers the six locations the Python pre-check tests name', () => {
    expect(NON_STANDARD_SHEET_LOCATIONS).toEqual([
      'xl/worksheets/sub/sheet1.xml',
      'xl/custom/sheet1.xml',
      'xl/worksheets/sheet1.XML',
      'sheet1.xml',
      'xl/worksheets/sheet1.bin',
      'xl/worksheets/sheet1',
    ]);
  });

  it.each([
    ['le', [0xff, 0xfe], 'utf-16le'],
    ['be', [0xfe, 0xff], 'utf-16be'],
  ] as const)('writes the sheet as UTF-16 %s after its BOM', (order, bom, label) => {
    const zip = buildUtf16SheetPackage(order, 150);

    const entry = directoryOf(zip).find(
      (candidate) => candidate.name === CELL_COUNT_SHEET,
    );
    if (entry == null) {
      throw new Error('no sheet');
    }
    const body = inflateRawSync(readLocalBody(zip, entry));

    expect([...body.subarray(0, 2)]).toEqual(bom);
    expect(new TextDecoder(label).decode(body.subarray(2))).toBe(
      cellsSheetXml(150),
    );
  });

  it('writes the same sheet part twice, with 1 and then 10 cells', () => {
    const zip = buildDuplicateSheetPartsPackage();

    expect(texts(zip, CELL_COUNT_SHEET).map(cellTags)).toEqual([1, 10]);
  });

  it('overwrites the sheet stream so it can no longer be inflated', () => {
    const zip = buildCorruptSheetStreamPackage();

    expect(() => texts(zip, CELL_COUNT_SHEET)).toThrow();
    expect(texts(zip, CELL_COUNT_WORKBOOK)).toEqual(['<workbook/>']);
  });
});

describe('buildDotDotTargetSheetXlsx', () => {
  it('reaches its only sheet through a relationship target that climbs out of xl/ with ..', async () => {
    const xlsx = buildDotDotTargetSheetXlsx(150);

    const names = directoryOf(xlsx).map((entry) => entry.name);
    const [rels] = texts(xlsx, 'xl/_rels/workbook.xml.rels');
    const [sheet] = texts(xlsx, 'sheet1.xml');

    expect(rels).toContain('Target="../sheet1.xml"');
    expect(names).toContain('sheet1.xml');
    expect(names.some((name) => name.startsWith('xl/worksheets/'))).toBe(false);
    expect(cellTags(sheet)).toBe(150);
    expect(await anydocMarkdown(xlsx, 'xlsx')).toContain(DOT_DOT_SHEET_MARKER);
  });
});

describe('workbooks for the sheet split', () => {
  it('appends a second copy of sheet 1 that anydoc reads in place of the first', async () => {
    const xlsx = buildDuplicatedEntryXlsx();

    const copies = texts(xlsx, 'xl/worksheets/sheet1.xml');

    expect(copies).toHaveLength(2);
    expect(copies[0]).toContain('first copy');
    expect(copies[1]).toContain('second copy');
    expect(await anydocMarkdown(xlsx, 'xlsx')).toContain('second copy');
  });

  it('stores every entry uncompressed and still reads as sheets A and B', async () => {
    const xlsx = buildStoredEntriesXlsx();

    const markdown = await anydocMarkdown(xlsx, 'xlsx');

    expect(new Set(directoryOf(xlsx).map((entry) => entry.method))).toEqual(
      new Set([0]),
    );
    expect(markdown).toMatch(/## A[\s\S]*\| a \|[\s\S]*## B[\s\S]*\| b \|/);
  });

  it('adds a 150 MiB pivot cache part to a small workbook that anydoc still converts', async () => {
    const xlsx = buildLargePivotCacheXlsx([
      { name: 'A', rows: [['a']] },
      { name: 'B', rows: [['b']] },
    ]);

    const pivot = directoryOf(xlsx).find(
      (entry) => entry.name === 'xl/pivotCache/pivotCacheRecords1.xml',
    );

    expect(xlsx.length).toBeLessThan(MIB);
    expect(pivot?.uncompressedSize).toBe(150 * MIB);
    expect(await anydocMarkdown(xlsx, 'xlsx')).toContain('| b |');
  }, 30_000);

  it('keeps defined names and a cached cross-sheet formula that name the sheets', async () => {
    const xlsx = buildStaleReferenceXlsx();

    const [workbook] = texts(xlsx, 'xl/workbook.xml');
    const [alpha] = texts(xlsx, 'xl/worksheets/sheet1.xml');

    expect(workbook).toContain("'Alpha'!$1:$1");
    expect(workbook).toContain('Beta!$A$1');
    expect(alpha).toContain(
      '</c><c r="B1" t="str"><f>Beta!A1</f><v>cached from beta</v></c></row>',
    );
    expect(await anydocMarkdown(xlsx, 'xlsx')).toContain('cached from beta');
  });
});
