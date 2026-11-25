import { crc32, deflateRawSync } from 'node:zlib';
import { toMarkdownBytes } from '@firecrawl/anydoc';

import {
  buildZip,
  type XlsxSheet,
  xlsxParts,
  type ZipInput,
} from '../../../test/fixtures';
import { deflateChunks } from '../../../test/fixtures/deflate-chunks';
import { createRandomBytes } from '../../../test/fixtures/seeded-random';
import {
  readZipDirectory,
  readZipEntries,
} from '../../../test/fixtures/spec-support';
import type { PageInfo } from '../../contract';
import { conversionErrorOf, conversionLimits } from '../spec-support';
import { convertXlsx } from './xlsx-split';

// How convertXlsx rewrites the package it hands to anydoc. anydoc is the
// external boundary: the real converter still runs, and the spy only records
// which package went in.
vi.mock('@firecrawl/anydoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@firecrawl/anydoc')>();
  return { ...actual, toMarkdownBytes: vi.fn(actual.toMarkdownBytes) };
});

const MIB = 1024 * 1024;
const WORKBOOK = 'xl/workbook.xml';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const CENTRAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

const anydoc = vi.mocked(toMarkdownBytes);

beforeEach(() => {
  anydoc.mockClear();
});

const limits = conversionLimits;

const sentPackages = (): Buffer[] =>
  anydoc.mock.calls.map(([bytes]) => Buffer.from(bytes));

const labels = (pages: readonly PageInfo[]) =>
  pages.map((page) => [page.pageNumber, page.label]);

const TWO_SHEETS: readonly XlsxSheet[] = [
  { name: 'A', rows: [['a text']] },
  { name: 'B', rows: [['b text']] },
];

// The streamed copy of every other part keeps the guarantees Python's
// `copy_part` had: bytes are counted as they are produced, never trusted from
// the headers, and every read failure becomes a classified ConversionError.
describe('copying the other parts into the package sent to anydoc', () => {
  const EXTRA_PART = 'xl/media/blob.bin';
  const LOCAL_HEADER_SIZE = 30;

  const withExtraPart = (extra: ZipInput): Buffer =>
    buildZip([...xlsxParts(TWO_SHEETS), extra]);

  // The extra part is written last, so its central record is the last one.
  const lastLocalHeader = (zip: Buffer): number =>
    (readZipDirectory(zip) ?? []).at(-1)?.localHeaderOffset ?? -1;
  const lastCentralRecord = (zip: Buffer): number =>
    zip.lastIndexOf(CENTRAL_SIGNATURE);

  const declaredTotal = (zip: Buffer): number =>
    (readZipDirectory(zip) ?? []).reduce(
      (sum, entry) => sum + entry.uncompressedSize,
      0,
    );

  const randomPart = (): Buffer => Buffer.from(createRandomBytes(2)(5000));

  it('copies a part byte for byte when the archive is exactly at the size limit', async () => {
    const part = Buffer.alloc(1000, 0x41);
    const zip = withExtraPart({ name: EXTRA_PART, data: part });

    const pages = await convertXlsx(
      zip,
      limits({ maxArchiveUncompressedBytes: declaredTotal(zip) }),
    );

    expect(labels(pages)).toEqual([
      [1, 'A'],
      [2, 'B'],
    ]);
    expect(
      readZipEntries(sentPackages()[0]).get(EXTRA_PART)?.equals(part),
    ).toBe(true);
  });

  it('is limit_exceeded one byte over the size limit', async () => {
    const zip = withExtraPart({
      name: EXTRA_PART,
      data: Buffer.alloc(1000, 0x41),
    });

    const error = await conversionErrorOf(() =>
      convertXlsx(
        zip,
        limits({ maxArchiveUncompressedBytes: declaredTotal(zip) - 1 }),
      ),
    );

    expect(error.kind).toBe('limit_exceeded');
    expect(sentPackages()).toEqual([]);
  });

  it('is malformed when the headers lie about the size of a part', async () => {
    const zip = withExtraPart({
      name: EXTRA_PART,
      data: 'B'.repeat(5000),
      method: 'stored',
    });
    const truth = Buffer.alloc(8);
    truth.writeUInt32LE(5000, 0);
    truth.writeUInt32LE(5000, 4);
    const lie = Buffer.alloc(8);
    lie.writeUInt32LE(10, 0);
    lie.writeUInt32LE(10, 4);
    for (
      let at = zip.indexOf(truth);
      at >= 0;
      at = zip.indexOf(truth, at + truth.length)
    ) {
      lie.copy(zip, at);
    }

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe('malformed');
    expect(sentPackages()).toEqual([]);
  });

  it('is malformed when the local header of a part is missing', async () => {
    const zip = withExtraPart({ name: EXTRA_PART, data: randomPart() });
    zip.writeUInt32LE(1, lastCentralRecord(zip) + 42);

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe('malformed');
    expect(sentPackages()).toEqual([]);
  });

  it.each([
    [
      'corrupt deflate stream',
      'malformed',
      (zip: Buffer) => {
        zip[lastLocalHeader(zip) + LOCAL_HEADER_SIZE + EXTRA_PART.length] =
          0x07;
      },
    ],
    [
      'unsupported compression method',
      'malformed',
      (zip: Buffer) => {
        zip.writeUInt16LE(9, lastLocalHeader(zip) + 8);
        zip.writeUInt16LE(9, lastCentralRecord(zip) + 10);
      },
    ],
    [
      'ZIP-level encryption flag',
      'encrypted',
      (zip: Buffer) => {
        zip.writeUInt16LE(1, lastLocalHeader(zip) + 6);
        zip.writeUInt16LE(1, lastCentralRecord(zip) + 8);
      },
    ],
  ])('classifies an undecodable part (%s) as %s', async (_case, kind, patch) => {
    const zip = withExtraPart({ name: EXTRA_PART, data: randomPart() });
    patch(zip);

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe(kind);
    expect(sentPackages()).toEqual([]);
  });

  it.each<'stored' | 'deflated'>([
    'stored',
    'deflated',
  ])('is malformed when the %s data of a part ends before its declared size', async (method) => {
    const zip = withExtraPart({
      name: EXTRA_PART,
      data: randomPart(),
      method,
    });
    const central = lastCentralRecord(zip);
    const overrun = zip.readUInt32LE(central + 20) + 100_000;
    zip.writeUInt32LE(overrun, central + 20);
    zip.writeUInt32LE(overrun, lastLocalHeader(zip) + 18);

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe('malformed');
  });

  it('is malformed when a part fails its CRC-32 check', async () => {
    const body = Buffer.from('<x/>');
    const zip = withExtraPart({
      name: EXTRA_PART,
      deflated: {
        body: deflateRawSync(body),
        crc32: crc32(body) ^ 1,
        uncompressedSize: body.length,
      },
    });

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe('malformed');
    expect(sentPackages()).toEqual([]);
  });

  it('leaves the input untouched, so converting it again gives the same pages', async () => {
    const zip = withExtraPart({ name: EXTRA_PART, data: randomPart() });
    const original = Buffer.from(zip);

    const first = await convertXlsx(zip, limits());
    const second = await convertXlsx(zip, limits());

    expect(zip.equals(original)).toBe(true);
    expect(second).toEqual(first);
  });

  it('streams a 200 MiB part into the package in full', async () => {
    const zeros = Buffer.alloc(MIB);
    const zip = withExtraPart({
      name: EXTRA_PART,
      deflated: deflateChunks(Array.from({ length: 200 }, () => zeros)),
      zip64: true,
    });
    anydoc.mockResolvedValueOnce('');

    await convertXlsx(zip, limits());

    const sent = (readZipDirectory(sentPackages()[0]) ?? []).find(
      (entry) => entry.name === EXTRA_PART,
    );
    expect(sent?.uncompressedSize).toBe(200 * MIB);
    expect(sentPackages()[0].length).toBeLessThan(2 * MIB);
  }, 60_000);
});

// research.md 18.10 and 22.8 item 2 (option a): entries the ZIP writer
// refuses by name are left out of the package, as the Python service's
// rewrite effectively did, and no entry shape may crash the process.
describe('entry names and shapes the package writer must survive', () => {
  const TWO_SHEET_PAGES = [
    { pageNumber: 1, label: 'A', content: '|  |\n| --- |\n| a text |' },
    { pageNumber: 2, label: 'B', content: '|  |\n| --- |\n| b text |' },
  ];
  const EMPTY_WORKBOOK = Buffer.from(
    `<workbook xmlns="${MAIN_NS}"><sheets/></workbook>`,
  );

  // 312 bytes: workbook.xml with its CRC-32 off by one bit, then a stored
  // entry with a name the writer refuses.
  const emptyWorkbookThen = (crcFlip: number, name: string): Buffer =>
    buildZip([
      {
        name: WORKBOOK,
        deflated: {
          body: deflateRawSync(EMPTY_WORKBOOK),
          crc32: crc32(EMPTY_WORKBOOK) ^ crcFlip,
          uncompressedSize: EMPTY_WORKBOOK.length,
        },
      },
      { name, data: 'x', method: 'stored' },
    ]);

  it.each([
    '../evil.txt',
    'C:/x.txt',
  ])('is malformed, without crashing, for a bad-CRC workbook followed by %s', async (name) => {
    const zip = emptyWorkbookThen(1, name);

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe('malformed');
  });

  it('returns no elements for a sound empty workbook followed by ../evil.txt', async () => {
    expect(
      await convertXlsx(emptyWorkbookThen(0, '../evil.txt'), limits()),
    ).toEqual([]);
  });

  it.each([
    '../evil.txt',
    'C:/x.txt',
    '/abs.txt',
    'xl\\',
  ])('converts the sheets and leaves out an entry named %s', async (name) => {
    const zip = buildZip([...xlsxParts(TWO_SHEETS), { name, data: 'x' }]);

    const pages = await convertXlsx(zip, limits());

    expect(pages).toEqual(TWO_SHEET_PAGES);
  });

  it('converts a workbook with directory entries xl/ and xl/worksheets/', async () => {
    const zip = buildZip([
      { name: 'xl/', data: '' },
      { name: 'xl/worksheets/', data: '' },
      ...xlsxParts(TWO_SHEETS),
    ]);

    expect(await convertXlsx(zip, limits())).toEqual(TWO_SHEET_PAGES);
  });

  it('converts a workbook with 9,000 directory entries', async () => {
    const directories: ZipInput[] = Array.from({ length: 9000 }, (_, i) => ({
      name: `d${i}/`,
      data: '',
      method: 'stored',
    }));
    const zip = buildZip([...xlsxParts(TWO_SHEETS), ...directories]);

    expect(await convertXlsx(zip, limits())).toEqual(TWO_SHEET_PAGES);
  }, 30_000);

  it('rejects an archive over the entry limit before anything is repackaged', async () => {
    const entries: ZipInput[] = Array.from({ length: 12_000 }, (_, i) => ({
      name: `xl/media/e${i}.bin`,
      data: '',
      method: 'stored',
    }));
    const zip = buildZip([...xlsxParts(TWO_SHEETS), ...entries]);

    const error = await conversionErrorOf(() => convertXlsx(zip, limits()));

    expect(error.kind).toBe('limit_exceeded');
    expect(sentPackages()).toEqual([]);
  }, 30_000);
});
