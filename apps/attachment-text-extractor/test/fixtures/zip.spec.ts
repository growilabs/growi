import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

import { readZipEntries } from './spec-support';
import { buildMimetypeFirstZip, buildZip } from './zip';

const LOCAL_HEADER_SIZE = 30;

const localHeaderAt = (zip: Buffer, offset: number) => ({
  signature: zip.readUInt32LE(offset),
  flags: zip.readUInt16LE(offset + 6),
  method: zip.readUInt16LE(offset + 8),
  compressedSize: zip.readUInt32LE(offset + 18),
  uncompressedSize: zip.readUInt32LE(offset + 22),
  name: zip
    .subarray(
      offset + LOCAL_HEADER_SIZE,
      offset + LOCAL_HEADER_SIZE + zip.readUInt16LE(offset + 26),
    )
    .toString('utf8'),
});

// Walks the local headers in file order, so each copy of a duplicate name is read.
const localEntryTexts = (zip: Buffer): [string, string][] => {
  const entries: [string, string][] = [];
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const header = localHeaderAt(zip, at);
    const bodyAt = at + LOCAL_HEADER_SIZE + Buffer.byteLength(header.name);
    const body = zip.subarray(bodyAt, bodyAt + header.compressedSize);
    entries.push([header.name, inflateRawSync(body).toString('utf8')]);
    at = bodyAt + header.compressedSize;
  }
  return entries;
};

const endOfCentralDirectory = (zip: Buffer) => {
  const at = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  return { totalEntries: zip.readUInt16LE(at + 10) };
};

describe('buildZip', () => {
  it('writes entries that an independent ZIP reader reads back unchanged', () => {
    const binary = Buffer.from([0, 1, 2, 250, 251, 252]);

    const zip = buildZip([
      { name: 'docs/readme.txt', data: 'hello zip '.repeat(50) },
      { name: 'bin/data.bin', data: binary, method: 'stored' },
    ]);

    const entries = readZipEntries(zip);
    expect(entries.get('docs/readme.txt')?.toString('utf8')).toBe(
      'hello zip '.repeat(50),
    );
    expect(entries.get('bin/data.bin')).toEqual(binary);
  });

  it('deflates by default and leaves stored entries uncompressed', () => {
    const text = 'a'.repeat(1000);

    const zip = buildZip([
      { name: 'deflated.txt', data: text },
      { name: 'stored.txt', data: text, method: 'stored' },
    ]);

    const deflated = localHeaderAt(zip, 0);
    expect(deflated.method).toBe(8);
    expect(deflated.compressedSize).toBeLessThan(text.length);
    const storedOffset =
      LOCAL_HEADER_SIZE + 'deflated.txt'.length + deflated.compressedSize;
    const stored = localHeaderAt(zip, storedOffset);
    expect(stored).toMatchObject({
      signature: 0x04034b50,
      method: 0,
      name: 'stored.txt',
      compressedSize: text.length,
      uncompressedSize: text.length,
    });
  });

  it('accepts an entry that was deflated beforehand', () => {
    const data = Buffer.from('pre-deflated body '.repeat(100));

    const zip = buildZip([
      {
        name: 'pre.xml',
        deflated: {
          body: deflateRawSync(data),
          crc32: crc32(data),
          uncompressedSize: data.length,
        },
      },
    ]);

    expect(readZipEntries(zip).get('pre.xml')).toEqual(data);
    expect(localHeaderAt(zip, 0).uncompressedSize).toBe(data.length);
  });

  it('keeps every entry as given, including duplicate names', () => {
    const zip = buildZip([
      { name: 'same.xml', data: 'first copy' },
      { name: 'same.xml', data: 'second copy' },
      { name: 'other.xml', data: 'other' },
    ]);

    expect(endOfCentralDirectory(zip).totalEntries).toBe(3);
    expect(localEntryTexts(zip)).toEqual([
      ['same.xml', 'first copy'],
      ['same.xml', 'second copy'],
      ['other.xml', 'other'],
    ]);
  });

  it('marks a non-ASCII entry name as UTF-8', () => {
    const zip = buildZip([{ name: 'シート.xml', data: 'x' }]);

    const header = localHeaderAt(zip, 0);
    expect(header.flags & 0x0800).toBe(0x0800);
    expect(header.name).toBe('シート.xml');
  });
});

describe('buildMimetypeFirstZip', () => {
  it('puts an uncompressed mimetype entry first, as ODF and EPUB require', () => {
    const mimetype = 'application/epub+zip';

    const zip = buildMimetypeFirstZip(mimetype, [
      { name: 'META-INF/container.xml', data: '<container/>' },
    ]);

    const first = localHeaderAt(zip, 0);
    expect(first).toMatchObject({ name: 'mimetype', method: 0 });
    const dataStart = LOCAL_HEADER_SIZE + 'mimetype'.length;
    expect(
      zip.subarray(dataStart, dataStart + mimetype.length).toString('ascii'),
    ).toBe(mimetype);
    expect(readZipEntries(zip).get('META-INF/container.xml')?.toString()).toBe(
      '<container/>',
    );
  });
});
