import { crc32, deflateRawSync } from 'node:zlib';

import { startOffsets } from './offsets';

// A hand-written ZIP writer: every header field is ours to set, so crafted
// archives (lying sizes, duplicate names, odd flags) are a byte patch away
// (research.md 9.7).

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** Defaults to `deflated`. */
  readonly method?: 'stored' | 'deflated';
  /** Writes the sizes in a zip64 extra field even when they fit in 32 bits. */
  readonly zip64?: boolean;
}

/** A body compressed beforehand, e.g. streamed through `createDeflateRaw`. */
export interface DeflatedBody {
  readonly body: Uint8Array;
  readonly crc32: number;
  readonly uncompressedSize: number;
}

export interface PreDeflatedZipEntry {
  readonly name: string;
  readonly deflated: DeflatedBody;
  readonly zip64?: boolean;
}

export type ZipInput = ZipEntry | PreDeflatedZipEntry;

interface EncodedEntry {
  readonly name: Buffer;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly body: Uint8Array;
  readonly uncompressedSize: number;
  readonly zip64: boolean;
}

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const VERSION_NEEDED = 20;
const VERSION_NEEDED_ZIP64 = 45;
const ZIP64_EXTRA_ID = 0x0001;
const UTF8_NAME_FLAG = 0x0800;
// 1980-01-01 00:00, the DOS epoch, so the output is reproducible.
const DOS_TIME = 0;
const DOS_DATE = 0x21;
const MAX_UINT32 = 0xffffffff;

const u16 = (value: number): Buffer => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};

const u32 = (value: number): Buffer => {
  if (value > MAX_UINT32) {
    throw new Error(
      `value ${value} does not fit in 32 bits; buildZip writes zip64 sizes only for entries marked zip64`,
    );
  }
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

const encodeEntry = (input: ZipInput): EncodedEntry => {
  const name = Buffer.from(input.name, 'utf8');
  const flags = name.length === input.name.length ? 0 : UTF8_NAME_FLAG;
  const zip64 = input.zip64 === true;
  if ('deflated' in input) {
    const { body, crc32: crc, uncompressedSize } = input.deflated;
    return {
      name,
      flags,
      method: METHOD_DEFLATED,
      crc,
      body,
      uncompressedSize,
      zip64,
    };
  }
  const data =
    typeof input.data === 'string'
      ? Buffer.from(input.data, 'utf8')
      : input.data;
  const stored = input.method === 'stored';
  return {
    name,
    flags,
    method: stored ? METHOD_STORED : METHOD_DEFLATED,
    crc: crc32(data),
    body: stored ? data : deflateRawSync(data),
    uncompressedSize: data.length,
    zip64,
  };
};

const u64 = (value: number): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};

// A zip64 entry keeps 0xffffffff in the 32-bit size fields and the real sizes
// (uncompressed first) in extra field 0x0001.
const extraField = (entry: EncodedEntry): Buffer =>
  entry.zip64
    ? Buffer.concat([
        u16(ZIP64_EXTRA_ID),
        u16(16),
        u64(entry.uncompressedSize),
        u64(entry.body.length),
      ])
    : Buffer.alloc(0);

const versionNeeded = (entry: EncodedEntry): number =>
  entry.zip64 ? VERSION_NEEDED_ZIP64 : VERSION_NEEDED;

// Fields shared by the local header and the central directory record.
const commonFields = (entry: EncodedEntry): Buffer[] => [
  u16(entry.flags),
  u16(entry.method),
  u16(DOS_TIME),
  u16(DOS_DATE),
  u32(entry.crc),
  u32(entry.zip64 ? MAX_UINT32 : entry.body.length),
  u32(entry.zip64 ? MAX_UINT32 : entry.uncompressedSize),
  u16(entry.name.length),
];

const localHeader = (entry: EncodedEntry): Buffer =>
  Buffer.concat([
    u32(0x04034b50),
    u16(versionNeeded(entry)),
    ...commonFields(entry),
    u16(extraField(entry).length),
    entry.name,
    extraField(entry),
  ]);

const centralRecord = (entry: EncodedEntry, offset: number): Buffer =>
  Buffer.concat([
    u32(0x02014b50),
    u16(versionNeeded(entry)),
    u16(versionNeeded(entry)),
    ...commonFields(entry),
    u16(extraField(entry).length),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    entry.name,
    extraField(entry),
  ]);

const endOfCentralDirectory = (
  count: number,
  directorySize: number,
  directoryOffset: number,
): Buffer =>
  Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(count),
    u16(count),
    u32(directorySize),
    u32(directoryOffset),
    u16(0),
  ]);

/** Writes entries in the given order; duplicate names are kept as given. */
export const buildZip = (inputs: readonly ZipInput[]): Buffer => {
  const entries = inputs.map(encodeEntry);
  const locals = entries.map((entry) =>
    Buffer.concat([localHeader(entry), entry.body]),
  );
  const localsBlock = Buffer.concat(locals);
  const offsets = startOffsets(
    0,
    locals.map((local) => local.length),
  );
  const directory = Buffer.concat(
    entries.map((entry, i) => centralRecord(entry, offsets[i])),
  );
  return Buffer.concat([
    localsBlock,
    directory,
    endOfCentralDirectory(entries.length, directory.length, localsBlock.length),
  ]);
};

/**
 * ODF and EPUB (OCF) packages: a `mimetype` entry first and stored, so its
 * text sits at a fixed offset where format sniffers look for it.
 */
export const buildMimetypeFirstZip = (
  mimetype: string,
  members: readonly ZipEntry[],
): Buffer =>
  buildZip([
    { name: 'mimetype', data: mimetype, method: 'stored' },
    ...members,
  ]);
