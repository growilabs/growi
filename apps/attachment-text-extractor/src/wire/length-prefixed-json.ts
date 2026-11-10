import type { Readable, Writable } from 'node:stream';

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

/** Reads exactly `length` bytes and puts any surplus back, so the next frame stays readable. */
const readExact = (stream: Readable, length: number): Promise<Buffer> => {
  const result = Buffer.allocUnsafe(length);
  if (length === 0) {
    return Promise.resolve(result);
  }
  return new Promise((resolve, reject) => {
    let received = 0;

    const finish = (settle: () => void): void => {
      stream.off('readable', pull);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('close', onEnd);
      settle();
    };
    const onEnd = (): void =>
      finish(() =>
        reject(
          new WireProtocolError('stream ended before the frame was complete'),
        ),
      );
    const onError = (error: Error): void => finish(() => reject(error));

    function pull(): void {
      while (received < length) {
        const chunk: Buffer | null = stream.read();
        if (chunk === null) {
          return;
        }
        const taken = Math.min(chunk.length, length - received);
        chunk.copy(result, received, 0, taken);
        received += taken;
        if (taken < chunk.length) {
          stream.unshift(chunk.subarray(taken));
        }
      }
      finish(() => resolve(result));
    }

    if (stream.readableEnded || stream.destroyed) {
      onEnd();
      return;
    }
    stream.on('readable', pull);
    stream.once('end', onEnd);
    stream.once('close', onEnd);
    stream.once('error', onError);
    pull();
  });
};

/**
 * Reads one frame; an over-limit length is refused from the header alone, before any body is read.
 * The stream must not be in flowing mode (never attach a 'data' listener to it), or this hangs.
 * A stream 'error' rejects with that error as is, not wrapped in WireProtocolError.
 */
export const readFrame = async (
  stream: Readable,
  maxLength: number,
): Promise<Buffer> => {
  const header = await readExact(stream, FRAME_HEADER_SIZE);
  const length = header.readUInt32BE();
  if (length > maxLength) {
    throw new WireProtocolError('frame length exceeds the allowed maximum');
  }
  return readExact(stream, length);
};

// Resolves once the chunk has been flushed, so a resolved writeFrame means everything is handed over.
const writeChunk = (stream: Writable, chunk: Uint8Array): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error == null ? resolve() : reject(error)));
  });

export const writeFrame = async (
  stream: Writable,
  body: Uint8Array,
): Promise<void> => {
  await writeChunk(stream, encodeFrameHeader(body.length));
  if (body.length > 0) {
    await writeChunk(stream, body);
  }
};
