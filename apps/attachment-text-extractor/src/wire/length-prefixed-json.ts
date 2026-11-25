import type { Writable } from 'node:stream';

import { WireProtocolError } from './wire-protocol-error';

export {
  CHILD_REPORTABLE_KINDS,
  decodeResult,
  encodeResult,
  MAX_DETAIL_CHARS,
} from './result-json';

export { WireProtocolError };

const FRAME_HEADER_SIZE = 4;
const MAX_FRAME_LENGTH = 0xffff_ffff;
const ENVELOPE_OVERHEAD_BYTES = 1024 * 1024;

/** Four bytes, big-endian. */
export const encodeFrameHeader = (length: number): Buffer => {
  if (!Number.isInteger(length) || length < 0 || length > MAX_FRAME_LENGTH) {
    throw new RangeError('frame length does not fit the 4-byte header');
  }
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  header.writeUInt32BE(length);
  return header;
};

/**
 * Ceiling for the encoded result frame body. MAX_RESULT_BYTES bounds the UTF-8 content;
 * JSON escaping ("\n" becomes 2 bytes) and the envelope add to it.
 */
export const maxResultFrameBytes = (maxResultBytes: number): number =>
  Math.min(2 * maxResultBytes + ENVELOPE_OVERHEAD_BYTES, MAX_FRAME_LENGTH);

// Resolves once the chunk has been flushed, so a resolved writeFrame means everything is handed over.
const writeChunk = (stream: Writable, chunk: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error == null ? resolve() : reject(error)));
  });

/** One frame whose body is `body`, or the pieces of it in order (never joined here). */
export const writeFrame = async (
  stream: Writable,
  body: Uint8Array | readonly Uint8Array[],
): Promise<void> => {
  const pieces = body instanceof Uint8Array ? [body] : body;
  const length = pieces.reduce((sum, piece) => sum + piece.length, 0);
  await writeChunk(stream, encodeFrameHeader(length));
  for (const piece of pieces) {
    if (piece.length > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: the pieces must reach the reader in order
      await writeChunk(stream, piece);
    }
  }
};
