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
}

export type ZipInput = ZipEntry | PreDeflatedZipEntry;

interface EncodedEntry {
  readonly name: Buffer;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly body: Uint8Array;
  readonly uncompressedSize: number;
}

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const VERSION_NEEDED = 20;
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
      `value ${value} needs zip64, which buildZip does not write`,
    );
  }
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
};

const encodeEntry = (input: ZipInput): EncodedEntry => {
  const name = Buffer.from(input.name, 'utf8');
  const flags = name.length === input.name.length ? 0 : UTF8_NAME_FLAG;
  if ('deflated' in input) {
    const { body, crc32: crc, uncompressedSize } = input.deflated;
    return {
      name,
      flags,
      method: METHOD_DEFLATED,
      crc,
      body,
      uncompressedSize,
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
  };
};

// Fields shared by the local header and the central directory record.
const commonFields = (entry: EncodedEntry): Buffer[] => [
  u16(entry.flags),
  u16(entry.method),
  u16(DOS_TIME),
  u16(DOS_DATE),
  u32(entry.crc),
  u32(entry.body.length),
  u32(entry.uncompressedSize),
  u16(entry.name.length),
];

const localHeader = (entry: EncodedEntry): Buffer =>
  Buffer.concat([
    u32(0x04034b50),
    u16(VERSION_NEEDED),
    ...commonFields(entry),
    u16(0),
    entry.name,
  ]);

const centralRecord = (entry: EncodedEntry, offset: number): Buffer =>
  Buffer.concat([
    u32(0x02014b50),
    u16(VERSION_NEEDED),
    u16(VERSION_NEEDED),
    ...commonFields(entry),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(offset),
    entry.name,
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
