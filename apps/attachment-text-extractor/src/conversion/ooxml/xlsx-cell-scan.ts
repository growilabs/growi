import type { Readable } from 'node:stream';

import { ConversionError } from '../conversion-error';
import { bufferChunk } from './zip-part-stream';

// The Python service's read size. Its count depends on where reads split a
// long tag head, so the stream is cut at the same offsets.
const CHUNK_BYTES = 64 * 1024;
// Longest start tag head kept between chunks; a longer one cannot be a cell.
const MAX_TAG_HEAD_BYTES = 64;
// xlsx_split.py's _CELL_START on bytes, here on the latin-1 string of the
// bytes: \w and the blanks are ASCII-only there, as they are written here.
const CELL_START = /<(?:[A-Za-z_][\w.-]*:)?c[ \t\n\r\f\v/>]/g;
const UTF16_BOMS = ['ÿþ', 'þÿ'];

export interface ScannedChunk {
  /** Cell tags that start in this chunk and cannot continue into the next. */
  readonly cells: number;
  /** Inflated bytes this chunk adds. */
  readonly bytes: number;
}

/** Cuts the stream into CHUNK_BYTES pieces at fixed offsets. */
async function* fixedChunks(stream: Readable): AsyncGenerator<Buffer> {
  const pending: Buffer[] = [];
  let pendingBytes = 0;
  for await (const chunk of stream) {
    let rest = bufferChunk(chunk);
    while (pendingBytes + rest.length >= CHUNK_BYTES) {
      const take = CHUNK_BYTES - pendingBytes;
      yield Buffer.concat([...pending, rest.subarray(0, take)], CHUNK_BYTES);
      rest = rest.subarray(take);
      pending.length = 0;
      pendingBytes = 0;
    }
    if (rest.length > 0) {
      pending.push(rest);
      pendingBytes += rest.length;
    }
  }
  if (pendingBytes > 0) {
    yield Buffer.concat(pending, pendingBytes);
  }
}

const countBefore = (text: string, end: number): number => {
  let count = 0;
  CELL_START.lastIndex = 0;
  for (
    let match = CELL_START.exec(text);
    match != null && match.index < end;
    match = CELL_START.exec(text)
  ) {
    count++;
  }
  return count;
};

/**
 * Counts cell start tags on the raw bytes of one part, one chunk at a time, so
 * memory stays flat however large the sheet is (no XML parse: anydoc already
 * holds the whole grid). Over-counting (CDATA, comments) only errs toward
 * refusing.
 */
export async function* scanCells(
  stream: Readable,
): AsyncGenerator<ScannedChunk> {
  let carry = '';
  let first = true;
  for await (const chunk of fixedChunks(stream)) {
    const text = chunk.toString('latin1');
    // The byte patterns are UTF-8 only; anydoc would read the part as UTF-16.
    if (first && UTF16_BOMS.some((bom) => text.startsWith(bom))) {
      throw new ConversionError(
        'malformed',
        'archive part uses an unsupported encoding',
      );
    }
    first = false;
    const buffer = carry + text;
    const lastOpen = buffer.lastIndexOf('<');
    // A tag head at the end may continue in the next chunk: counted later.
    const split =
      lastOpen < 0 || buffer.length - lastOpen > MAX_TAG_HEAD_BYTES
        ? buffer.length
        : lastOpen;
    carry = buffer.slice(split);
    yield { cells: countBefore(buffer, split), bytes: chunk.length };
  }
  yield { cells: countBefore(carry, carry.length), bytes: 0 };
}
