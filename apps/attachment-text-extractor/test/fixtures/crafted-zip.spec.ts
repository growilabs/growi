import { crc32, inflateRawSync } from 'node:zlib';

import {
  buildCorruptBzip2Zip,
  buildCorruptDeflateZip,
  buildCorruptLzmaZip,
  buildDuplicateNameZip,
  buildEncryptedFlagZip,
  buildLyingSizesZip,
  buildTraversalNamesZip,
  buildTruncatedZip,
  buildUnsupportedMethodZip,
  buildUtf8FlagWithNonUtf8NameZip,
  buildVersionNeeded10xZip,
  buildZip64BombPartZip,
  buildZip64Zip,
  buildZipWithoutCentralDirectory,
  CRAFTED_ZIP_PART,
} from './crafted-zip';
import {
  type RawZipEntry,
  readLocalBody,
  readLocalHeader,
  readZipDirectory,
} from './spec-support';

const MIB = 1024 * 1024;
const LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const CENTRAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);

const onlyEntry = (zip: Buffer): RawZipEntry => {
  const entries = readZipDirectory(zip);
  if (entries?.length !== 1) {
    throw new Error(`expected one entry, got ${entries?.length}`);
  }
  return entries[0];
};

describe('ZIPs whose one part cannot be decoded', () => {
  it('corrupts the deflate stream so it cannot be inflated', () => {
    const zip = buildCorruptDeflateZip();

    const entry = onlyEntry(zip);

    expect(entry).toMatchObject({ name: CRAFTED_ZIP_PART, method: 8 });
    expect(() => inflateRawSync(readLocalBody(zip, entry))).toThrow();
  });

  it('names compression method 9, which no ZIP reader here implements, in both headers', () => {
    const zip = buildUnsupportedMethodZip();

    const entry = onlyEntry(zip);

    expect(entry.method).toBe(9);
    expect(readLocalHeader(zip, entry).method).toBe(9);
  });

  it('sets the ZIP encryption flag in both headers', () => {
    const zip = buildEncryptedFlagZip();

    const entry = onlyEntry(zip);

    expect(entry.flags & 1).toBe(1);
    expect(readLocalHeader(zip, entry).flags & 1).toBe(1);
  });

  it.each([
    ['bzip2', buildCorruptBzip2Zip, 12],
    ['LZMA', buildCorruptLzmaZip, 14],
  ])('names %s and stores a stream that is not one', (_, build, method) => {
    const zip = build();

    const entry = onlyEntry(zip);
    const body = readLocalBody(zip, entry);

    expect(entry.method).toBe(method);
    expect(readLocalHeader(zip, entry).method).toBe(method);
    expect(body.subarray(0, 3).toString('latin1')).not.toBe('BZh');
    expect(body.includes(Buffer.from('A'.repeat(12)))).toBe(true);
  });

  it('starts the LZMA body with the 4-byte properties header that ZIP requires', () => {
    const zip = buildCorruptLzmaZip();

    const body = readLocalBody(zip, onlyEntry(zip));

    // LZMA SDK version, then the size of the properties that follow (5).
    expect(body.readUInt16LE(2)).toBe(5);
  });
});

describe('ZIPs whose directory a strict reader refuses', () => {
  it('flags the name as UTF-8 in the central directory while the bytes are not UTF-8', () => {
    const zip = buildUtf8FlagWithNonUtf8NameZip();

    const entry = onlyEntry(zip);

    expect(entry.flags & 0x0800).toBe(0x0800);
    expect(() =>
      new TextDecoder('utf-8', { fatal: true }).decode(entry.nameBytes),
    ).toThrow();
  });

  it('asks for ZIP version 10.0 in the central directory', () => {
    expect(onlyEntry(buildVersionNeeded10xZip()).versionNeeded).toBe(100);
  });
});

describe('buildLyingSizesZip', () => {
  it('declares 10 bytes in both headers for a stored part of 5000, so the CRC only matches the full body', () => {
    const zip = buildLyingSizesZip();

    const entry = onlyEntry(zip);
    const local = readLocalHeader(zip, entry);
    const fullBody = zip.subarray(
      entry.localHeaderOffset + 30 + entry.nameBytes.length,
      entry.localHeaderOffset + 30 + entry.nameBytes.length + 5000,
    );

    expect(entry).toMatchObject({
      name: 'a.xml',
      method: 0,
      compressedSize: 10,
      uncompressedSize: 10,
    });
    expect(local).toMatchObject({ compressedSize: 10, uncompressedSize: 10 });
    expect(crc32(readLocalBody(zip, entry))).not.toBe(entry.crc32);
    expect(fullBody).toEqual(Buffer.from('B'.repeat(5000)));
    expect(crc32(fullBody)).toBe(entry.crc32);
  });
});

describe('ZIPs with unusual names', () => {
  it('keeps two entries of the required part, first and second', () => {
    const zip = buildDuplicateNameZip();

    const entries = readZipDirectory(zip) ?? [];

    expect(entries.map((entry) => entry.name)).toEqual([
      CRAFTED_ZIP_PART,
      CRAFTED_ZIP_PART,
    ]);
    expect(
      entries.map((entry) =>
        inflateRawSync(readLocalBody(zip, entry)).toString(),
      ),
    ).toEqual(['first', 'second']);
  });

  it('adds entries named with a parent traversal and an absolute path', () => {
    const names = (readZipDirectory(buildTraversalNamesZip()) ?? []).map(
      (entry) => entry.name,
    );

    expect(names).toEqual([
      CRAFTED_ZIP_PART,
      '../../evil.txt',
      '/abs/evil.txt',
    ]);
  });
});

describe('zip64 archives', () => {
  it('writes the tiny required part as a zip64 entry that still inflates to <x/>', () => {
    const zip = buildZip64Zip();

    const entry = onlyEntry(zip);

    expect(entry).toMatchObject({
      name: CRAFTED_ZIP_PART,
      hasZip64Extra: true,
      uncompressedSize: 4,
    });
    expect(inflateRawSync(readLocalBody(zip, entry)).toString()).toBe('<x/>');
  });

  it('declares a 200 MiB part in an archive under 1 MB', () => {
    const zip = buildZip64BombPartZip();

    const entry = onlyEntry(zip);

    expect(zip.length).toBeLessThan(1_000_000);
    expect(entry).toMatchObject({
      name: CRAFTED_ZIP_PART,
      hasZip64Extra: true,
      uncompressedSize: 200 * MIB,
    });
  });
});

describe('ZIPs cut short', () => {
  it('keeps only the first half of a real ZIP, so its directory is gone', () => {
    const zip = buildTruncatedZip();

    expect(zip.subarray(0, 4)).toEqual(LOCAL_SIGNATURE);
    expect(zip.includes(END_SIGNATURE)).toBe(false);
  });

  it('keeps every local entry but no central directory', () => {
    const zip = buildZipWithoutCentralDirectory();

    expect(zip.subarray(0, 4)).toEqual(LOCAL_SIGNATURE);
    expect(zip.includes(Buffer.from(CRAFTED_ZIP_PART))).toBe(true);
    expect(zip.includes(CENTRAL_SIGNATURE)).toBe(false);
    expect(zip.includes(END_SIGNATURE)).toBe(false);
  });
});
