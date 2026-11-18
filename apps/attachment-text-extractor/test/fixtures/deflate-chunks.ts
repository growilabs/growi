import { constants, crc32, deflateRawSync } from 'node:zlib';

import type { DeflatedBody } from './zip';

// Each chunk is deflated on its own and ended with a sync flush, which leaves
// a byte-aligned, non-final block; the pieces then join into one stream. So a
// part of hundreds of MiB is never held whole, and a chunk that repeats (the
// same object) is compressed only once.
const syncFlushed = (chunk: Uint8Array): Buffer =>
  deflateRawSync(chunk, { finishFlush: constants.Z_SYNC_FLUSH });

/** Deflates the chunks, joined in order, into one raw deflate stream. */
export const deflateChunks = (chunks: Iterable<Uint8Array>): DeflatedBody => {
  const pieces: Buffer[] = [];
  let crc = 0;
  let uncompressedSize = 0;
  let lastChunk: Uint8Array | undefined;
  let lastPiece: Buffer = Buffer.alloc(0);
  for (const chunk of chunks) {
    if (chunk !== lastChunk) {
      lastChunk = chunk;
      lastPiece = syncFlushed(chunk);
    }
    pieces.push(lastPiece);
    crc = crc32(chunk, crc);
    uncompressedSize += chunk.length;
  }
  // An empty input deflated normally is just a final empty block.
  pieces.push(deflateRawSync(Buffer.alloc(0)));
  return { body: Buffer.concat(pieces), crc32: crc, uncompressedSize };
};
