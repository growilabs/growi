import { deflateChunks } from './deflate-chunks';
import { createRandomBytes } from './seeded-random';
import { buildZip } from './zip';

// The archives crafted inside the Python service's test_archive_guard.py,
// written with buildZip and then patched at the same byte offsets.

/** The part the Python archive-guard tests ask for. */
export const CRAFTED_ZIP_PART = 'ppt/presentation.xml';

const MIB = 1024 * 1024;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
const METHOD_UNSUPPORTED = 9;
const METHOD_BZIP2 = 12;
const METHOD_LZMA = 14;
const ENCRYPTED_FLAG = 0x0001;
const UTF8_NAME_FLAG = 0x0800;
// Central directory offsets: version-needed@6 flags@8 method@10 name@46.
// Local header offsets: flags@6 method@8 name@30.
const CENTRAL_VERSION_NEEDED = 6;
const CENTRAL_FLAGS = 8;
const CENTRAL_METHOD = 10;
const CENTRAL_NAME = 46;
const LOCAL_FLAGS = 6;
const LOCAL_METHOD = 8;
const BODY_START = LOCAL_HEADER_SIZE + CRAFTED_ZIP_PART.length;
const LZMA_PROPERTIES_HEADER = Buffer.from([9, 4, 5, 0]);
const CORRUPTED_BYTES = 12;

type Patch = (copy: Buffer) => void;

/** A patched copy; the source buffer is left as it is. */
const patched = (source: Buffer, ...patches: readonly Patch[]): Buffer => {
  const copy = Buffer.from(source);
  for (const patch of patches) {
    patch(copy);
  }
  return copy;
};

const u16At =
  (offset: (zip: Buffer) => number, value: number): Patch =>
  (zip) => {
    zip.writeUInt16LE(value, offset(zip));
  };

const central = (field: number) => (zip: Buffer) =>
  zip.lastIndexOf(CENTRAL_SIGNATURE) + field;

const local = (field: number) => () => field;

const xorRange =
  (start: number, length: number): Patch =>
  (zip) => {
    for (let i = start; i < start + length; i++) {
      zip[i] ^= 0xff;
    }
  };

// 2000 random bytes then 5000 'A's, as Python's `_craft_zip` (seeded differently).
const craftedZip = (): Buffer =>
  buildZip([
    {
      name: CRAFTED_ZIP_PART,
      data: Buffer.concat([
        createRandomBytes(1)(2000),
        Buffer.from('A'.repeat(5000)),
      ]),
    },
  ]);

/** The first deflate block header says BFINAL=1 with the reserved type 11. */
export const buildCorruptDeflateZip = (): Buffer =>
  patched(craftedZip(), (zip) => {
    zip[BODY_START] = 0x07;
  });

export const buildUnsupportedMethodZip = (): Buffer =>
  patched(
    craftedZip(),
    u16At(local(LOCAL_METHOD), METHOD_UNSUPPORTED),
    u16At(central(CENTRAL_METHOD), METHOD_UNSUPPORTED),
  );

export const buildEncryptedFlagZip = (): Buffer =>
  patched(
    craftedZip(),
    u16At(local(LOCAL_FLAGS), ENCRYPTED_FLAG),
    u16At(central(CENTRAL_FLAGS), ENCRYPTED_FLAG),
  );

export const buildUtf8FlagWithNonUtf8NameZip = (): Buffer =>
  patched(
    craftedZip(),
    u16At(central(CENTRAL_FLAGS), UTF8_NAME_FLAG),
    (zip) => {
      zip[central(CENTRAL_NAME)(zip)] = 0xff;
    },
  );

export const buildVersionNeeded10xZip = (): Buffer =>
  patched(craftedZip(), u16At(central(CENTRAL_VERSION_NEEDED), 100));

const sizePair = (compressed: number, uncompressed: number): Buffer => {
  const pair = Buffer.alloc(8);
  pair.writeUInt32LE(compressed, 0);
  pair.writeUInt32LE(uncompressed, 4);
  return pair;
};

/** A stored 5000-byte `a.xml` whose headers both claim 10 bytes. */
export const buildLyingSizesZip = (): Buffer => {
  const honest = buildZip([
    { name: 'a.xml', data: 'B'.repeat(5000), method: 'stored' },
  ]);
  const truth = sizePair(5000, 5000);
  const lie = sizePair(10, 10);
  return patched(honest, (zip) => {
    for (
      let at = zip.indexOf(truth);
      at >= 0;
      at = zip.indexOf(truth, at + truth.length)
    ) {
      lie.copy(zip, at);
    }
  });
};

export const buildDuplicateNameZip = (): Buffer =>
  buildZip([
    { name: CRAFTED_ZIP_PART, data: 'first' },
    { name: CRAFTED_ZIP_PART, data: 'second' },
  ]);

export const buildTraversalNamesZip = (): Buffer =>
  buildZip([
    { name: CRAFTED_ZIP_PART, data: '<x/>' },
    { name: '../../evil.txt', data: 'x' },
    { name: '/abs/evil.txt', data: 'x' },
  ]);

/** The required part written with zip64 sizes although it is 4 bytes. */
export const buildZip64Zip = (): Buffer =>
  buildZip([{ name: CRAFTED_ZIP_PART, data: '<x/>', zip64: true }]);

/** A zip64 part of 200 MiB of zeros in an archive well under 1 MB. */
export const buildZip64BombPartZip = (): Buffer => {
  const zeros = Buffer.alloc(MIB);
  const chunks = Array.from({ length: 200 }, () => zeros);
  return buildZip([
    { name: CRAFTED_ZIP_PART, deflated: deflateChunks(chunks), zip64: true },
  ]);
};

// Node has no bzip2 or LZMA compressor, so the method is named over a stream
// that is not one (research.md 9.1); Python likewise flips its first bytes.
const corruptStoredAs = (method: number, header: Buffer): Buffer => {
  const stored = buildZip([
    { name: CRAFTED_ZIP_PART, data: 'A'.repeat(3000), method: 'stored' },
  ]);
  return patched(
    stored,
    u16At(local(LOCAL_METHOD), method),
    u16At(central(CENTRAL_METHOD), method),
    (zip) => {
      header.copy(zip, BODY_START);
    },
    xorRange(BODY_START + header.length, CORRUPTED_BYTES),
  );
};

export const buildCorruptBzip2Zip = (): Buffer =>
  corruptStoredAs(METHOD_BZIP2, Buffer.alloc(0));

/** ZIP's LZMA entries start with a version and properties-size header. */
export const buildCorruptLzmaZip = (): Buffer =>
  corruptStoredAs(METHOD_LZMA, LZMA_PROPERTIES_HEADER);

/** The first half of a real ZIP: its directory is gone. */
export const buildTruncatedZip = (): Buffer => {
  const whole = buildZip([
    { name: CRAFTED_ZIP_PART, data: '<x/>'.repeat(100) },
  ]);
  return whole.subarray(0, Math.floor(whole.length / 2));
};

/** Every local entry, whole, and no central directory after them. */
export const buildZipWithoutCentralDirectory = (): Buffer => {
  const whole = buildZip([
    { name: CRAFTED_ZIP_PART, data: '<x/>' },
    { name: 'other.xml', data: 'y' },
  ]);
  return whole.subarray(0, whole.indexOf(CENTRAL_SIGNATURE));
};
