import {
  buildEncryptedXlsx,
  buildLargeForTimeoutXlsx,
  buildOneSheetAtCellLimitXlsx,
  buildOneSheetOverCellLimitXlsx,
  buildOverCellLimitXlsx,
  buildZip,
  PLAIN_DOCUMENTS,
} from '../../../test/fixtures';
import type { ConversionLimits } from '../../contract';
import { conversionErrorOf, conversionLimits } from '../spec-support';
import { inspectArchive } from './archive-guard';
import { enforceCellLimit } from './xlsx-cell-count';

const MIB = 1024 * 1024;
const WORKBOOK = 'xl/workbook.xml';
const SHEET1 = 'xl/worksheets/sheet1.xml';

const limits = (cells = 70_000, uncompressedMb = 512): ConversionLimits =>
  conversionLimits({
    maxXlsxCells: cells,
    maxArchiveUncompressedBytes: uncompressedMb * MIB,
  });

const packageOf = (
  parts: readonly (readonly [string, string | Uint8Array])[],
): Buffer =>
  buildZip([
    { name: WORKBOOK, data: '<workbook/>' },
    ...parts.map(([name, data]) => ({ name, data })),
  ]);

const sheet = (body: string): string =>
  `<worksheet xmlns="m"><sheetData><row r="1">${body}</row></sheetData></worksheet>`;

const cells = (count: number): string => '<c r="A1"><v>1</v></c>'.repeat(count);

/** Opens with `openLimits` (the ZIP pre-check), then counts with `countLimits`. */
const check = async (
  data: Uint8Array,
  countLimits: ConversionLimits,
  openLimits: ConversionLimits = countLimits,
): Promise<void> => {
  const archive = await inspectArchive(data, WORKBOOK, openLimits);
  if (archive == null) {
    throw new Error('expected the workbook archive to be returned');
  }
  try {
    await enforceCellLimit(archive, countLimits);
  } finally {
    archive.close();
  }
};

const failureKind = async (
  data: Uint8Array,
  countLimits: ConversionLimits,
  openLimits?: ConversionLimits,
): Promise<string> =>
  (await conversionErrorOf(() => check(data, countLimits, openLimits))).kind;

describe('enforceCellLimit counts cell tags on the raw bytes', () => {
  it('passes a workbook at the limit and refuses one more cell', async () => {
    await expect(
      check(packageOf([[SHEET1, sheet(cells(50))]]), limits(50)),
    ).resolves.toBeUndefined();
    expect(
      await failureKind(packageOf([[SHEET1, sheet(cells(51))]]), limits(50)),
    ).toBe('limit_exceeded');
  });

  it('totals the cells across all sheets', async () => {
    const data = packageOf(
      [1, 2, 3].map((i) => [`xl/worksheets/sheet${i}.xml`, sheet(cells(20))]),
    );

    await expect(check(data, limits(60))).resolves.toBeUndefined();
    expect(await failureKind(data, limits(59))).toBe('limit_exceeded');
  });

  it('does not count tags that merely start with c, CDATA or escaped text', async () => {
    const noise =
      '<cols><col min="1" max="1"/></cols><cfRule type="x"/><calcChain/><cellStyle/><c-x/><![CDATA[]]>&lt;c &gt;';
    const counted =
      '<c r="A1"/><c r="B1" t="s"><v>0</v></c><c>\n</c><c\tr="C1"/>';
    const data = packageOf([[SHEET1, sheet(noise + counted)]]);

    await expect(check(data, limits(4))).resolves.toBeUndefined();
    expect(await failureKind(data, limits(3))).toBe('limit_exceeded');
  });

  it('counts namespace-prefixed cells', async () => {
    const body = '<x:c r="A1"/><x:c r="B1"><x:v>1</x:v></x:c><x:col/>';
    const data = packageOf([
      [
        SHEET1,
        `<x:worksheet><x:sheetData><x:row>${body}</x:row></x:sheetData></x:worksheet>`,
      ],
    ]);

    await expect(check(data, limits(2))).resolves.toBeUndefined();
    expect(await failureKind(data, limits(1))).toBe('limit_exceeded');
  });

  // Python shrank its read chunk to 8 bytes; the Node reader's chunk size is
  // not a parameter, so 50,000 four-byte cells (about 200 KB, inflated in
  // 16 KiB pieces) put a tag head across many boundaries, shifted by `offset`.
  it.each([
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ])('counts a cell tag cut by a read boundary once (offset %i)', async (offset) => {
    const data = packageOf([
      [SHEET1, sheet(`${'x'.repeat(offset)}${'<c/>'.repeat(50_000)}`)],
    ]);

    await expect(check(data, limits(50_000))).resolves.toBeUndefined();
    expect(await failureKind(data, limits(49_999))).toBe('limit_exceeded');
  });

  it('skips relationship parts but counts every other part', async () => {
    await expect(
      check(
        packageOf([
          ['xl/_rels/workbook.xml.rels', cells(100)],
          ['_rels/.rels', cells(100)],
          [SHEET1, sheet(cells(3))],
        ]),
        limits(3),
      ),
    ).resolves.toBeUndefined();
    expect(
      await failureKind(
        packageOf([['xl/sharedStrings.xml', cells(4)]]),
        limits(3),
      ),
    ).toBe('limit_exceeded');
  });

  it.each([
    'xl/worksheets/sub/sheet1.xml',
    'xl/custom/sheet1.xml',
    'xl/worksheets/sheet1.XML',
    'sheet1.xml',
    'xl/worksheets/sheet1.bin',
    'xl/worksheets/sheet1',
  ])('counts a sheet stored at %s', async (name) => {
    const data = packageOf([[name, sheet(cells(150))]]);

    await expect(check(data, limits(150))).resolves.toBeUndefined();
    expect(await failureKind(data, limits(149))).toBe('limit_exceeded');
  });

  it.each([
    ['UTF-16LE', Buffer.from([0xff, 0xfe]), 'utf16le' as const],
    ['UTF-16BE', Buffer.from([0xfe, 0xff]), 'utf16be' as const],
  ])('does not let a %s sheet hide its cells', async (_, bom, encoding) => {
    const encoded = Buffer.from(sheet(cells(150)), 'utf16le');
    const body = Buffer.concat([
      bom,
      encoding === 'utf16le' ? encoded : encoded.swap16(),
    ]);

    expect(['limit_exceeded', 'malformed']).toContain(
      await failureKind(packageOf([[SHEET1, body]]), limits(149)),
    );
  });

  it('scans every copy of a duplicated part', async () => {
    const data = packageOf([
      [SHEET1, sheet(cells(1))],
      [SHEET1, sheet(cells(10))],
    ]);

    expect(await failureKind(data, limits(5))).toBe('limit_exceeded');
  });

  it('skips directory entries', async () => {
    const data = packageOf([
      ['xl/', ''],
      ['xl/worksheets/', ''],
      [SHEET1, sheet(cells(1))],
    ]);

    await expect(check(data, limits(1))).resolves.toBeUndefined();
  });

  it('passes a workbook without worksheets even with a limit of 0', async () => {
    await expect(check(packageOf([]), limits(0))).resolves.toBeUndefined();
  });

  it('bounds the inflated bytes by the archive limit, counted as they are produced', async () => {
    const data = packageOf([[SHEET1, sheet(`<!--${'a'.repeat(3 * MIB)}-->`)]]);

    expect(await failureKind(data, limits(70_000, 2), limits())).toBe(
      'limit_exceeded',
    );
  });

  it('refuses a corrupt worksheet stream as malformed', async () => {
    const data = packageOf([[SHEET1, sheet(cells(500))]]);
    const start =
      data.indexOf('worksheets/sheet1.xml') +
      'worksheets/sheet1.xml'.length +
      10;
    data.fill(0xff, start, start + 20);

    expect(await failureKind(data, limits())).toBe('malformed');
  });

  it('leaves non-ZIP input and encrypted XLSX to the caller', async () => {
    expect(
      await inspectArchive(buildEncryptedXlsx(), WORKBOOK, limits()),
    ).toBeNull();
    expect(
      await inspectArchive(Buffer.from('not a zip'), WORKBOOK, limits()),
    ).toBeNull();
  });
});

describe('enforceCellLimit on generated workbooks', () => {
  it.each([
    ['multi-sheet', PLAIN_DOCUMENTS.xlsxMultiSheet.build],
    ['single-sheet', PLAIN_DOCUMENTS.xlsxSingleSheet.build],
    ['hidden-sheet', PLAIN_DOCUMENTS.xlsxHiddenSheet.build],
    ['chart-sheet', PLAIN_DOCUMENTS.xlsxChartSheet.build],
  ])('passes the %s workbook under the default limit', async (_, build) => {
    await expect(check(build(), limits())).resolves.toBeUndefined();
  });

  it('passes 70,000 cells over five sheets and refuses 70,001 cells', async () => {
    await expect(
      check(buildLargeForTimeoutXlsx(), limits()),
    ).resolves.toBeUndefined();
    expect(await failureKind(buildOverCellLimitXlsx(), limits())).toBe(
      'limit_exceeded',
    );
  });

  it('admits 70,000 cells in one sheet and refuses 70,001 under the default limits', async () => {
    await expect(
      check(buildOneSheetAtCellLimitXlsx(), conversionLimits()),
    ).resolves.toBeUndefined();
    expect(
      await failureKind(buildOneSheetOverCellLimitXlsx(), conversionLimits()),
    ).toBe('limit_exceeded');
  });

  // Python also bounded the heap growth with tracemalloc; heap sampling is
  // unreliable under parallel vitest workers, and the child's RSS monitor
  // (research.md 22.7, 4.3 list) owns memory, so only the observable result
  // of the large scan is kept.
  it('passes a sheet of 150,000 cells (over 3 MiB) under a larger limit', async () => {
    const body = sheet(cells(150_000));
    expect(body.length).toBeGreaterThan(3 * MIB);

    await expect(
      check(packageOf([[SHEET1, body]]), limits(1_000_000)),
    ).resolves.toBeUndefined();
  });
});
