// The archive as CPython's zipfile reads it (_RealGetContents): stray bytes
// before or after the archive, a central directory read by its size alone
// (the entry counts, the disk number and a comment cut short by the end of
// the file are not checked), and entries flagged "strong encryption", which
// CPython refuses only when they are read. yauzl refuses all of these. The
// end record is looked for in the whole file, not only in the last 64 KiB
// as CPython's _EndRecData does (research.md §3.2).

const END_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIGNATURE_BYTES = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_RECORD_BYTES = 22;
const CENTRAL_RECORD_BYTES = 46;
const ZIP64_LOCATOR_BYTES = 20;
const MAX_COMMENT_BYTES = 0xffff;
// The end record's 16-bit entry count; a larger directory is left to yauzl.
const MAX_REPAIRABLE_ENTRIES = 0xffff;
export const STRONG_ENCRYPTION_FLAG = 0x40;
const CENTRAL_FLAGS_FIELD = 8;

export interface ZipExtent {
  readonly bytes: Uint8Array;
  /** Positions in the central directory of entries flagged strong encryption, cleared in `bytes`. */
  readonly strongEncryption: ReadonlySet<number>;
}

interface CentralDirectory {
  readonly entries: number;
  /** Records flagged strong encryption: offset in the input, position in the directory. */
  readonly strongRecords: readonly (readonly [
    offset: number,
    position: number,
  ])[];
}

const hasZip64Locator = (data: Buffer, at: number): boolean =>
  at >= ZIP64_LOCATOR_BYTES &&
  data.readUInt32LE(at - ZIP64_LOCATOR_BYTES) === ZIP64_LOCATOR_SIGNATURE;

/** Whether the end record at `at` is preceded by its directory, by size, or by a zip64 locator. */
const leadsToDirectory = (data: Buffer, at: number): boolean => {
  const start = at - data.readUInt32LE(at + 12);
  return (
    hasZip64Locator(data, at) ||
    (start >= 0 &&
      start + 4 <= at &&
      data.readUInt32LE(start) === CENTRAL_SIGNATURE)
  );
};

/**
 * In the last 64 KiB, the last end record as it is. Before them, the last
 * one that leads to its directory, or else the last one if a central record
 * signature comes before it anywhere; a lone end record signature there is
 * not a ZIP (research.md §3.2).
 */
const endRecordAt = (data: Buffer): number => {
  const last = data.length - END_RECORD_BYTES;
  if (last < 0) {
    return -1;
  }
  if (
    data.subarray(last, last + 4).equals(END_SIGNATURE) &&
    data.readUInt16LE(data.length - 2) === 0
  ) {
    return last;
  }
  const newest = data.lastIndexOf(END_SIGNATURE, last);
  if (newest >= Math.max(last - MAX_COMMENT_BYTES, 0)) {
    return newest;
  }
  // lastIndexOf counts a negative start from the end of the buffer.
  for (
    let at = newest;
    at >= 0;
    at = at > 0 ? data.lastIndexOf(END_SIGNATURE, at - 1) : -1
  ) {
    if (leadsToDirectory(data, at)) {
      return at;
    }
  }
  const firstCentral = data.indexOf(CENTRAL_SIGNATURE_BYTES);
  return firstCentral >= 0 && firstCentral < newest ? newest : -1;
};

/** The central directory in `size` bytes from `start`, or null where CPython stops. */
const readCentralDirectory = (
  data: Buffer,
  start: number,
  size: number,
): CentralDirectory | null => {
  let entries = 0;
  const strongRecords: [number, number][] = [];
  for (let at = start; at - start < size; entries++) {
    if (
      at + CENTRAL_RECORD_BYTES > start + size ||
      data.readUInt32LE(at) !== CENTRAL_SIGNATURE
    ) {
      return null;
    }
    if (
      (data.readUInt16LE(at + CENTRAL_FLAGS_FIELD) & STRONG_ENCRYPTION_FLAG) !==
      0
    ) {
      strongRecords.push([at, entries]);
    }
    at +=
      CENTRAL_RECORD_BYTES +
      data.readUInt16LE(at + 28) +
      data.readUInt16LE(at + 30) +
      data.readUInt16LE(at + 32);
  }
  return { entries, strongRecords };
};

/** The archive copied with a repaired end record and the strong-encryption flags cleared. */
const repaired = (
  data: Buffer,
  at: number,
  prepended: number,
  directory: CentralDirectory,
): Buffer => {
  const copy = Buffer.concat([
    data.subarray(prepended, at),
    repairedEndRecord(data.subarray(at), directory.entries),
  ]);
  for (const [offset] of directory.strongRecords) {
    const field = offset - prepended + CENTRAL_FLAGS_FIELD;
    copy.writeUInt16LE(
      copy.readUInt16LE(field) & ~STRONG_ENCRYPTION_FLAG,
      field,
    );
  }
  return copy;
};

const NONE: ReadonlySet<number> = new Set();
const unchanged = (bytes: Uint8Array): ZipExtent => ({
  bytes,
  strongEncryption: NONE,
});

/** The same record with the fields yauzl checks set from the directory itself. */
const repairedEndRecord = (end: Buffer, entries: number): Buffer => {
  const record = Buffer.from(end.subarray(0, END_RECORD_BYTES));
  record.writeUInt32LE(0, 4);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt16LE(0, 20);
  return record;
};

const isCleanForYauzl = (data: Buffer, at: number, entries: number): boolean =>
  data.readUInt16LE(at + 4) === 0 &&
  data.readUInt16LE(at + 10) === entries &&
  at + END_RECORD_BYTES + data.readUInt16LE(at + 20) <= data.length;

/**
 * The bytes for yauzl to read, or null when they hold no end-of-central-
 * directory record. Usually the input itself; a slice when the archive sits among
 * stray bytes; a repaired copy when the end record's counts, disk number or
 * comment length are off, or when an entry is flagged strong encryption.
 */
export const zipExtent = (bytes: Uint8Array): ZipExtent | null => {
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = endRecordAt(data);
  if (at < 0) {
    return null;
  }
  const commentEnd = Math.min(
    at + END_RECORD_BYTES + data.readUInt16LE(at + 20),
    data.length,
  );
  if (hasZip64Locator(data, at)) {
    // zip64: only stray bytes after the archive are dropped.
    return unchanged(bytes.subarray(0, commentEnd));
  }
  const size = data.readUInt32LE(at + 12);
  const prepended = at - size - data.readUInt32LE(at + 16);
  const directory =
    prepended >= 0 ? readCentralDirectory(data, at - size, size) : null;
  if (directory == null) {
    // Unlike CPython, a directory not where the end record's size and offset
    // put it is left to yauzl, so the limits still apply (research.md §3.2).
    return unchanged(bytes);
  }
  const { entries, strongRecords } = directory;
  if (
    entries > MAX_REPAIRABLE_ENTRIES ||
    (strongRecords.length === 0 && isCleanForYauzl(data, at, entries))
  ) {
    return unchanged(bytes.subarray(prepended, commentEnd));
  }
  return {
    bytes: repaired(data, at, prepended, directory),
    strongEncryption: new Set(strongRecords.map(([, position]) => position)),
  };
};
