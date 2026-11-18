import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { constants, crc32, deflateRawSync } from 'node:zlib';

import {
  buildCorruptBzip2Zip,
  buildCorruptDeflateZip,
  buildCorruptLzmaZip,
  buildDuplicateNameZip,
  buildEncryptedDocx,
  buildEncryptedFlagZip,
  buildEncryptedPptx,
  buildEncryptedXlsx,
  buildLyingSizesZip,
  buildTruncatedZip,
  buildUnsupportedMethodZip,
  buildUtf8FlagWithNonUtf8NameZip,
  buildVersionNeeded10xZip,
  buildZip,
  buildZip64BombPartZip,
  buildZip64Zip,
  buildZipBombDocx,
  buildZipWithoutCentralDirectory,
  CRAFTED_ZIP_PART,
  PLAIN_DOCUMENTS,
  type ZipInput,
} from '../../../test/fixtures';
import { createRandomBytes } from '../../../test/fixtures/seeded-random';
import { conversionErrorOf, conversionLimits } from '../spec-support';
import { inspectArchive, type OoxmlArchive } from './archive-guard';

const MIB = 1024 * 1024;
const PPTX_PART = CRAFTED_ZIP_PART;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const END_OF_DIRECTORY_SIZE = 22;
const END_OF_DIRECTORY_OFFSET_FIELD = 16;
const CENTRAL_COMPRESSED_SIZE_FIELD = 20;

const limits = (entries = 100, uncompressedMb = 1) =>
  conversionLimits({
    maxArchiveEntries: entries,
    maxArchiveUncompressedBytes: uncompressedMb * MIB,
  });

const zip = (
  members: readonly (readonly [string, string | Uint8Array])[],
  method: 'stored' | 'deflated' = 'deflated',
): Buffer => buildZip(members.map(([name, data]) => ({ name, data, method })));

const withArchive = async <T>(
  bytes: Uint8Array,
  requiredPart: string,
  run: (archive: OoxmlArchive) => Promise<T>,
  archiveLimits = limits(),
): Promise<T> => {
  const archive = await inspectArchive(bytes, requiredPart, archiveLimits);
  if (archive == null) {
    throw new Error('expected the archive to be returned, got pass-through');
  }
  try {
    return await run(archive);
  } finally {
    archive.close();
  }
};

const readAllEntries = (archive: OoxmlArchive): Promise<Buffer[]> =>
  Promise.all(
    archive.entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => archive.readPart(entry.name, 10 * MIB)),
  );

// The part's data stops 100 bytes in while the central directory still
// declares all of it: the Node form of Python's buffer truncated after open.
const partEndingBeforeItsDeclaredSize = (
  method: 'stored' | 'deflated',
): Buffer => {
  const whole = zip([[PPTX_PART, createRandomBytes(2)(5000)]], method);
  const directoryStart = whole.lastIndexOf(CENTRAL_SIGNATURE);
  const kept = LOCAL_HEADER_SIZE + PPTX_PART.length + 100;
  const cut = Buffer.concat([
    whole.subarray(0, kept),
    whole.subarray(directoryStart),
  ]);
  cut.writeUInt32LE(
    kept,
    cut.length - END_OF_DIRECTORY_SIZE + END_OF_DIRECTORY_OFFSET_FIELD,
  );
  return cut;
};

describe('inspectArchive passes non-ZIP and unreadable input through', () => {
  it('returns the archive open when the required part is there', async () => {
    const data = zip([
      [PPTX_PART, '<x/>'],
      ['other.xml', 'y'],
    ]);

    const part = await withArchive(data, PPTX_PART, (archive) =>
      archive.readPart(PPTX_PART, 100),
    );

    expect(part.toString()).toBe('<x/>');
  });

  it('passes a ZIP without the required part through', async () => {
    const data = zip([['word/document.xml', '<x/>']]);

    expect(await inspectArchive(data, PPTX_PART, limits())).toBeNull();
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['plain text', Buffer.from('plain text, not a zip')],
    [
      'a local header signature then zeros',
      Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), Buffer.alloc(10)]),
    ],
  ])('passes %s input through', async (_, data) => {
    expect(await inspectArchive(data, PPTX_PART, limits())).toBeNull();
  });

  it('passes the first half of a real ZIP through', async () => {
    expect(
      await inspectArchive(buildTruncatedZip(), PPTX_PART, limits()),
    ).toBeNull();
  });

  it('passes an empty ZIP through', async () => {
    expect(await inspectArchive(buildZip([]), PPTX_PART, limits())).toBeNull();
  });

  it.each([
    ['docx', buildEncryptedDocx],
    ['xlsx', buildEncryptedXlsx],
    ['pptx', buildEncryptedPptx],
  ])('passes an encrypted %s (an OLE file, not a ZIP) through', async (_, build) => {
    expect(await inspectArchive(build(), PPTX_PART, limits())).toBeNull();
  });

  it('passes local entries without a central directory through', async () => {
    expect(
      await inspectArchive(
        buildZipWithoutCentralDirectory(),
        PPTX_PART,
        limits(),
      ),
    ).toBeNull();
  });

  it('passes a ZIP with the required part twice through', async () => {
    expect(
      await inspectArchive(buildDuplicateNameZip(), PPTX_PART, limits()),
    ).toBeNull();
  });

  // CPython's zipfile refuses these, so Python hands them to anydoc whole.
  it.each([
    ['an entry needing version 10.0 to extract', buildVersionNeeded10xZip],
    ['a UTF-8-flagged name that is not UTF-8', buildUtf8FlagWithNonUtf8NameZip],
  ])('passes %s through', async (_, build) => {
    expect(await inspectArchive(build(), PPTX_PART, limits())).toBeNull();
  });
});

describe('inspectArchive enforces the entry count and the declared size', () => {
  it('refuses more entries than the limit', async () => {
    const data = zip([
      [PPTX_PART, 'a'],
      ...Array.from({ length: 5 }, (_, i) => [`f${i}.xml`, ''] as const),
    ]);

    const error = await conversionErrorOf(() =>
      inspectArchive(data, PPTX_PART, limits(5)),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('accepts exactly the entry limit', async () => {
    const data = zip([
      [PPTX_PART, 'a'],
      ...Array.from({ length: 4 }, (_, i) => [`f${i}.xml`, ''] as const),
    ]);

    const parts = await withArchive(data, PPTX_PART, readAllEntries, limits(5));

    expect(parts).toHaveLength(5);
  });

  it('refuses 10,001 entries under the default limit of 10,000', async () => {
    const data = zip(
      [
        [PPTX_PART, 'a'],
        ...Array.from({ length: 10_000 }, (_, i) => [`f${i}.xml`, ''] as const),
      ],
      'stored',
    );

    const error = await conversionErrorOf(() =>
      inspectArchive(data, PPTX_PART, conversionLimits()),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('refuses parts each under the limit whose declared sum is over it', async () => {
    const chunk = 'A'.repeat(Math.floor(0.6 * MIB));
    const data = zip([
      [PPTX_PART, chunk],
      ['big2.bin', chunk],
    ]);

    const error = await conversionErrorOf(() =>
      inspectArchive(data, PPTX_PART, limits(100, 1)),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('checks the limit before it looks for the required part', async () => {
    const data = zip([['big.bin', 'A'.repeat(2 * MIB)]]);

    const error = await conversionErrorOf(() =>
      inspectArchive(data, PPTX_PART, limits(100, 1)),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('refuses the DOCX zip bomb under the default 512 MiB limit', async () => {
    const error = await conversionErrorOf(() =>
      inspectArchive(buildZipBombDocx(), 'word/document.xml', limits(100, 512)),
    );

    expect(error.kind).toBe('limit_exceeded');
  });
});

describe('inspectArchive accepts real packages', () => {
  it('accepts a generated PPTX', async () => {
    const deck = PLAIN_DOCUMENTS.pptxMultiSlide.build();

    const parts = await withArchive(deck, PPTX_PART, readAllEntries);

    expect(parts.length).toBeGreaterThan(1);
  });

  it('accepts a generated XLSX', async () => {
    const book = PLAIN_DOCUMENTS.xlsxMultiSheet.build();

    const parts = await withArchive(book, 'xl/workbook.xml', readAllEntries);

    expect(parts.length).toBeGreaterThan(1);
  });

  it('accepts a part written with zip64 sizes', async () => {
    const part = await withArchive(buildZip64Zip(), PPTX_PART, (archive) =>
      archive.readPart(PPTX_PART, 100),
    );

    expect(part.toString()).toBe('<x/>');
  });

  it('reads parts named ../ or /abs in memory and never writes them to disk', async () => {
    const id = randomUUID();
    const relative = `../../evil-${id}.txt`;
    const absolute = `/abs-${id}/evil.txt`;
    const data = zip([
      [PPTX_PART, '<x/>'],
      [relative, 'x'],
      [absolute, 'x'],
    ]);

    const names = await withArchive(data, PPTX_PART, async (archive) => {
      await readAllEntries(archive);
      return archive.entries.map((entry) => entry.name);
    });

    expect(names).toEqual([PPTX_PART, relative, absolute]);
    expect(existsSync(path.resolve(relative))).toBe(false);
    expect(existsSync(absolute)).toBe(false);
  });

  it('keeps every copy of a duplicated part that is not the required one', async () => {
    const data = zip([
      [PPTX_PART, '<x/>'],
      ['dup.xml', 'first'],
      ['dup.xml', 'second'],
    ]);

    const names = await withArchive(data, PPTX_PART, async (archive) =>
      archive.entries.map((entry) => entry.name),
    );

    expect(names).toEqual([PPTX_PART, 'dup.xml', 'dup.xml']);
  });

  it('accepts directory entries and marks them as directories', async () => {
    const data = zip([
      ['xl/', ''],
      ['xl/worksheets/', ''],
      ['xl/workbook.xml', '<workbook/>'],
    ]);

    const seen = await withArchive(
      data,
      'xl/workbook.xml',
      async (archive) => ({
        directories: archive.entries
          .filter((entry) => entry.isDirectory)
          .map((entry) => entry.name),
        workbook: (await archive.readPart('xl/workbook.xml', 100)).toString(),
      }),
    );

    expect(seen).toEqual({
      directories: ['xl/', 'xl/worksheets/'],
      workbook: '<workbook/>',
    });
  });

  it('accepts 9,000 directory entries under the default limits', async () => {
    const data = buildZip([
      ...Array.from(
        { length: 9_000 },
        (_, i): ZipInput => ({ name: `d${i}/`, data: '', method: 'stored' }),
      ),
      { name: 'xl/workbook.xml', data: '<workbook/>' },
    ]);

    const workbook = await withArchive(
      data,
      'xl/workbook.xml',
      (archive) => archive.readPart('xl/workbook.xml', 100),
      conversionLimits(),
    );

    expect(workbook.toString()).toBe('<workbook/>');
  });
});

describe('entry names', () => {
  it('decodes a UTF-8-flagged name as UTF-8', async () => {
    const data = zip([
      [PPTX_PART, '<x/>'],
      ['日本語.xml', 'x'],
    ]);

    const names = await withArchive(data, PPTX_PART, async (archive) =>
      archive.entries.map((entry) => entry.name),
    );

    expect(names).toContain('日本語.xml');
  });

  // Node-specific (research.md 18.7 item 7): Python's zipfile reads a name
  // without the UTF-8 flag as cp437 ('ü'); TextDecoder has no cp437, so Node
  // reads latin-1. OOXML part names are ASCII, so lookups are unaffected.
  it('decodes a name without the UTF-8 flag as latin-1, not cp437', async () => {
    const data = zip([
      [PPTX_PART, '<x/>'],
      ['q.xml', 'x'],
    ]);
    for (
      let at = data.indexOf('q.xml');
      at >= 0;
      at = data.indexOf('q.xml', at + 1)
    ) {
      data[at] = 0x81;
    }

    const names = await withArchive(data, PPTX_PART, async (archive) =>
      archive.entries.map((entry) => entry.name),
    );

    expect(names).toEqual([PPTX_PART, '\u0081.xml']);
  });
});

describe('readPart', () => {
  it('returns the part when it fits the cap', async () => {
    const data = zip([['a.xml', '12345']]);

    const part = await withArchive(data, 'a.xml', (archive) =>
      archive.readPart('a.xml', 5),
    );

    expect(part.toString()).toBe('12345');
  });

  it('refuses a part over the cap', async () => {
    const data = zip([['a.xml', 'A'.repeat(1000)]]);

    const error = await withArchive(data, 'a.xml', (archive) =>
      conversionErrorOf(() => archive.readPart('a.xml', 999)),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it('never truncates silently when the headers lie about the size', async () => {
    const error = await withArchive(buildLyingSizesZip(), 'a.xml', (archive) =>
      conversionErrorOf(() => archive.readPart('a.xml', 100_000)),
    );

    expect(error.kind).toBe('malformed');
  });

  it('refuses a part that is not in the archive as malformed', async () => {
    const data = zip([['a.xml', 'x']]);

    const error = await withArchive(data, 'a.xml', (archive) =>
      conversionErrorOf(() => archive.readPart('nope.xml', 10)),
    );

    expect(error.kind).toBe('malformed');
  });

  it.each([
    ['a corrupt deflate stream', buildCorruptDeflateZip, 'malformed'],
    ['compression method 9', buildUnsupportedMethodZip, 'malformed'],
    ['the ZIP encryption flag', buildEncryptedFlagZip, 'encrypted'],
  ])('maps %s to %s', async (_, build, kind) => {
    const error = await withArchive(build(), PPTX_PART, (archive) =>
      conversionErrorOf(() => archive.readPart(PPTX_PART, 1_000_000)),
    );

    expect(error.kind).toBe(kind);
  });

  it.each([
    ['stored', 'stored' as const],
    ['deflated', 'deflated' as const],
  ])('refuses a %s part whose data ends before its declared size', async (_, method) => {
    const error = await withArchive(
      partEndingBeforeItsDeclaredSize(method),
      PPTX_PART,
      (archive) =>
        conversionErrorOf(() => archive.readPart(PPTX_PART, 1_000_000)),
    );

    expect(error.kind).toBe('malformed');
  });

  it('refuses to read from a closed archive as malformed', async () => {
    const archive = await inspectArchive(
      zip([[PPTX_PART, '<x/>']]),
      PPTX_PART,
      limits(),
    );
    if (archive == null) {
      throw new Error('expected the archive to be returned');
    }
    archive.close();

    const error = await conversionErrorOf(() =>
      archive.readPart(PPTX_PART, 100),
    );

    expect(error.kind).toBe('malformed');
  });

  // Python bounded the peak memory with tracemalloc; here the next case shows
  // the read stops at the cap, and the real child returning limit_exceeded
  // rather than memory_exceeded is a 4.3 case (research.md 22.7, 4.3 list).
  it('stops a 200 MiB zip-bomb part at the cap', async () => {
    const data = buildZip64BombPartZip();
    expect(data.length).toBeLessThan(1_000_000);

    const error = await withArchive(
      data,
      PPTX_PART,
      (archive) => conversionErrorOf(() => archive.readPart(PPTX_PART, MIB)),
      limits(100, 512),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  // The stream inflates 4 MiB, then hits an invalid block: a reader that stops
  // at the cap never reaches it, one that inflates the whole part first reports
  // malformed instead.
  it('stops inflating at the cap instead of inflating the whole part first', async () => {
    const body = Buffer.concat([
      deflateRawSync(Buffer.alloc(4 * MIB), {
        finishFlush: constants.Z_SYNC_FLUSH,
      }),
      Buffer.alloc(64, 0xff),
    ]);
    const data = buildZip([
      {
        name: PPTX_PART,
        deflated: { body, crc32: 0, uncompressedSize: 200 * MIB },
      },
    ]);

    const error = await withArchive(
      data,
      PPTX_PART,
      (archive) => conversionErrorOf(() => archive.readPart(PPTX_PART, MIB)),
      limits(100, 512),
    );

    expect(error.kind).toBe('limit_exceeded');
  });

  it.each([
    ['bzip2', buildCorruptBzip2Zip],
    ['LZMA', buildCorruptLzmaZip],
  ])('refuses a corrupt %s entry as malformed', async (_, build) => {
    const error = await withArchive(build(), PPTX_PART, (archive) =>
      conversionErrorOf(() => archive.readPart(PPTX_PART, 1_000_000)),
    );

    expect(error.kind).toBe('malformed');
  });

  it('refuses a part whose CRC-32 does not match as malformed', async () => {
    const body = Buffer.from('<x/>'.repeat(100));
    const data = buildZip([
      {
        name: PPTX_PART,
        deflated: {
          body: deflateRawSync(body),
          crc32: crc32(body) ^ 1,
          uncompressedSize: body.length,
        },
      },
    ]);

    const error = await withArchive(data, PPTX_PART, (archive) =>
      conversionErrorOf(() => archive.readPart(PPTX_PART, 1_000_000)),
    );

    expect(error.kind).toBe('malformed');
  });
});

// research.md 18.7 item 9 (ZIP table) / 22.6: yauzl is looser than CPython's
// zipfile on these broken ZIPs. Python refuses both as malformed; Node reads
// the part, and the contract is only that it returns instead of failing.
describe('broken ZIPs Node reads where Python refuses them', () => {
  it('reads by the central directory name when the local header names the part differently', async () => {
    const data = zip([
      [PPTX_PART, '<x/>'],
      ['other.xml', 'y'],
    ]);
    data[LOCAL_HEADER_SIZE] = 'q'.charCodeAt(0);

    const part = await withArchive(data, PPTX_PART, (archive) =>
      archive.readPart(PPTX_PART, 100),
    );

    expect(part.toString()).toBe('<x/>');
  });

  it('reads a deflated part whose central directory overstates its compressed size', async () => {
    const body = 'hello world '.repeat(50);
    const data = zip([
      [PPTX_PART, body],
      ['other.xml', 'y'],
    ]);
    const central = data.indexOf(CENTRAL_SIGNATURE);
    const field = central + CENTRAL_COMPRESSED_SIZE_FIELD;
    data.writeUInt32LE(data.readUInt32LE(field) + 20, field);

    const part = await withArchive(data, PPTX_PART, (archive) =>
      archive.readPart(PPTX_PART, 10_000),
    );

    expect(part.toString()).toBe(body);
  });
});
