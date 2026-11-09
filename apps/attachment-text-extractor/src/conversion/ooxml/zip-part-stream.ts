import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { crc32 } from 'node:zlib';
import type { Entry, ZipFile } from 'yauzl';

import { ConversionError } from '../conversion-error';

const ENCRYPTED_FLAG = 0x1;
// "Compressed patched data" and "strong encryption", which CPython refuses to read.
const UNREADABLE_FLAGS = 0x20 | 0x40;

export const unreadablePart = (): ConversionError =>
  new ConversionError('malformed', 'archive part could not be read');

/** Narrows a stream chunk; a part stream only ever carries Buffers. */
export const bufferChunk = (chunk: unknown): Buffer => {
  if (!Buffer.isBuffer(chunk)) {
    throw new TypeError('expected a Buffer chunk');
  }
  return chunk;
};

const openRaw = (zip: ZipFile, raw: Entry): Promise<Readable> =>
  new Promise((resolve, reject) => {
    zip.openReadStream(raw, (error, stream) => {
      if (error == null) {
        resolve(stream);
      } else {
        reject(unreadablePart());
      }
    });
  });

// yauzl checks neither CRC-32 (its README) nor, as opened here, the size.
// As in CPython, bytes past the declared size fail the read and the CRC-32
// is checked at the end; a stream ending short of the declared size is read
// by its CRC-32 alone.
const integrityCheck = (raw: Entry): Transform => {
  let crc = 0;
  let size = 0;
  return new Transform({
    transform(chunk: unknown, _encoding, next: TransformCallback) {
      const bytes = bufferChunk(chunk);
      size += bytes.length;
      crc = crc32(bytes, crc);
      next(size > raw.uncompressedSize ? unreadablePart() : null, bytes);
    },
    flush(next: TransformCallback) {
      next(crc === raw.crc32 >>> 0 ? null : unreadablePart());
    },
  });
};

/**
 * The inflated bytes of one entry, whose stored general purpose flags are
 * `flags`. Opening fails with `encrypted` or
 * `malformed`; the stream fails with `malformed` on any read error, on bytes
 * past the declared size, or on a CRC-32 mismatch. Destroying it stops the read.
 */
export const openPartStream = async (
  zip: ZipFile,
  raw: Entry,
  flags: number,
): Promise<Readable> => {
  // The Python service calls any refusal to open a part `encrypted` when the
  // part carries the encryption flag, whatever else is flagged. That holds only
  // after CPython has accepted the local header; a broken header is `malformed`
  // there, which this check does not reproduce.
  if ((flags & ENCRYPTED_FLAG) !== 0) {
    throw new ConversionError('encrypted', 'archive part is encrypted');
  }
  if ((flags & UNREADABLE_FLAGS) !== 0) {
    throw unreadablePart();
  }
  const source = await openRaw(zip, raw);
  const checked = integrityCheck(raw);
  // pipe() forwards failures in neither direction.
  source.on('error', () => checked.destroy(unreadablePart()));
  checked.on('close', () => source.destroy());
  return source.pipe(checked);
};

/** Reads a part whole, stopping as soon as it passes `maxBytes`. */
export const collectPart = async (
  stream: Readable,
  maxBytes: number,
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = bufferChunk(chunk);
    total += bytes.length;
    if (total > maxBytes) {
      throw new ConversionError(
        'limit_exceeded',
        'archive part exceeds the per-part size limit',
      );
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
};
