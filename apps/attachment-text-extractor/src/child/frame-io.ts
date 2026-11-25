import { readSync, writeSync } from 'node:fs';

import {
  encodeFrameHeader,
  WireProtocolError,
} from '../wire/length-prefixed-json';

const FRAME_HEADER_SIZE = 4;
const RETRY_WAIT_MS = 1;

const isErrorCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

// The child's pipes are blocking, but if one ever is not, EAGAIN must mean
// "try again", not a broken frame.
const waitBriefly = (): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_WAIT_MS);
};

const readSome = (fd: number, into: Buffer, offset: number): number => {
  try {
    return readSync(fd, into, offset, into.length - offset, null);
  } catch (error) {
    if (isErrorCode(error, 'EAGAIN')) {
      waitBriefly();
      return -1;
    }
    throw new WireProtocolError('input could not be read');
  }
};

const readExact = (fd: number, length: number): Buffer => {
  const buffer = Buffer.allocUnsafe(length);
  let filled = 0;
  while (filled < length) {
    const read = readSome(fd, buffer, filled);
    if (read === 0) {
      throw new WireProtocolError('input ended before the frame was complete');
    }
    filled += Math.max(read, 0);
  }
  return buffer;
};

/**
 * Reads one frame from a blocking fd into a buffer of exactly its length, which
 * is handed on as is (research.md 20.6: the input is never copied). An
 * over-limit length is refused from the four header bytes alone.
 */
export const readFrameSync = (fd: number, maxLength: number): Buffer => {
  const length = readExact(fd, FRAME_HEADER_SIZE).readUInt32BE(0);
  if (length > maxLength) {
    throw new WireProtocolError('frame length exceeds the allowed maximum');
  }
  return readExact(fd, length);
};

const writeAll = (fd: number, data: Uint8Array): void => {
  let written = 0;
  while (written < data.length) {
    try {
      written += writeSync(fd, data, written, data.length - written);
    } catch (error) {
      if (!isErrorCode(error, 'EAGAIN')) {
        throw error;
      }
      waitBriefly();
    }
  }
};

/** Header and body are written separately, so a large body is never copied into one buffer. */
export const writeFrameSync = (fd: number, body: Uint8Array): void => {
  writeAll(fd, encodeFrameHeader(body.length));
  writeAll(fd, body);
};
