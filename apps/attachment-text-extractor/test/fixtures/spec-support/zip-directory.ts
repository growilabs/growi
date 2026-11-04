// A raw reader of ZIP headers for specs on crafted archives. It reports the
// fields as written, without judging them, so a spec can check a lie (a wrong
// size, an odd flag, a zip64 extra field) that a real ZIP reader would refuse.

const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const ZIP64_EXTRA_ID = 0x0001;
const ZIP64_MARKER = 0xffffffff;

export interface RawZipEntry {
  /** The name bytes as stored (not decoded). */
  readonly nameBytes: Buffer;
  readonly name: string;
  readonly versionNeeded: number;
  readonly flags: number;
  readonly method: number;
  readonly crc32: number;
  /** The 32-bit header fields, 0xffffffff when the sizes live in zip64. */
  readonly headerCompressedSize: number;
  readonly headerUncompressedSize: number;
  /** Sizes after applying a zip64 extra field, if any. */
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly hasZip64Extra: boolean;
  readonly localHeaderOffset: number;
}

interface Zip64Sizes {
  readonly uncompressed?: number;
  readonly compressed?: number;
}

const zip64Sizes = (
  extra: Buffer,
  needsUncompressed: boolean,
  needsCompressed: boolean,
): Zip64Sizes | undefined => {
  for (let at = 0; at + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(at);
    const size = extra.readUInt16LE(at + 2);
    if (id === ZIP64_EXTRA_ID) {
      const uncompressedAt = at + 4;
      const compressedAt = uncompressedAt + (needsUncompressed ? 8 : 0);
      return {
        uncompressed: needsUncompressed
          ? Number(extra.readBigUInt64LE(uncompressedAt))
          : undefined,
        compressed: needsCompressed
          ? Number(extra.readBigUInt64LE(compressedAt))
          : undefined,
      };
    }
    at += 4 + size;
  }
  return undefined;
};

const centralEntryAt = (zip: Buffer, at: number): [RawZipEntry, number] => {
  const nameLength = zip.readUInt16LE(at + 28);
  const extraLength = zip.readUInt16LE(at + 30);
  const commentLength = zip.readUInt16LE(at + 32);
  const nameStart = at + CENTRAL_HEADER_SIZE;
  const nameBytes = zip.subarray(nameStart, nameStart + nameLength);
  const extra = zip.subarray(
    nameStart + nameLength,
    nameStart + nameLength + extraLength,
  );
  const headerCompressedSize = zip.readUInt32LE(at + 20);
  const headerUncompressedSize = zip.readUInt32LE(at + 24);
  const sizes = zip64Sizes(
    extra,
    headerUncompressedSize === ZIP64_MARKER,
    headerCompressedSize === ZIP64_MARKER,
  );
  const entry: RawZipEntry = {
    nameBytes,
    name: nameBytes.toString('utf8'),
    versionNeeded: zip.readUInt16LE(at + 6),
    flags: zip.readUInt16LE(at + 8),
    method: zip.readUInt16LE(at + 10),
    crc32: zip.readUInt32LE(at + 16),
    headerCompressedSize,
    headerUncompressedSize,
    compressedSize: sizes?.compressed ?? headerCompressedSize,
    uncompressedSize: sizes?.uncompressed ?? headerUncompressedSize,
    hasZip64Extra: sizes != null,
    localHeaderOffset: zip.readUInt32LE(at + 42),
  };
  return [entry, nameStart + nameLength + extraLength + commentLength];
};

/** The central directory records in order, or `undefined` if there is none. */
export const readZipDirectory = (zip: Buffer): RawZipEntry[] | undefined => {
  const end = zip.lastIndexOf(END_SIGNATURE);
  if (end < 0) {
    return undefined;
  }
  const count = zip.readUInt16LE(end + 10);
  const entries: RawZipEntry[] = [];
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`no central directory record at ${at}`);
    }
    const [entry, next] = centralEntryAt(zip, at);
    entries.push(entry);
    at = next;
  }
  return entries;
};

/** The stored (possibly compressed) body of an entry, cut by its compressed size. */
export const readLocalBody = (zip: Buffer, entry: RawZipEntry): Buffer => {
  const at = entry.localHeaderOffset;
  const bodyAt =
    at +
    LOCAL_HEADER_SIZE +
    zip.readUInt16LE(at + 26) +
    zip.readUInt16LE(at + 28);
  return zip.subarray(bodyAt, bodyAt + entry.compressedSize);
};

/** The local header's own fields, which a crafted archive may set apart from the directory. */
export const readLocalHeader = (zip: Buffer, entry: RawZipEntry) => ({
  flags: zip.readUInt16LE(entry.localHeaderOffset + 6),
  method: zip.readUInt16LE(entry.localHeaderOffset + 8),
  compressedSize: zip.readUInt32LE(entry.localHeaderOffset + 18),
  uncompressedSize: zip.readUInt32LE(entry.localHeaderOffset + 22),
  extraLength: zip.readUInt16LE(entry.localHeaderOffset + 28),
});
