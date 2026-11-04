import { crc32, deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const BIT_DEPTH = 8;
const GRAYSCALE = 0;
const NO_FILTER = 0;

const chunk = (kind: string, body: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(kind, 'latin1'), body]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, checksum]);
};

const header = (side: number): Buffer => {
  const body = Buffer.alloc(13);
  body.writeUInt32BE(side, 0);
  body.writeUInt32BE(side, 4);
  body[8] = BIT_DEPTH;
  body[9] = GRAYSCALE;
  return body;
};

/**
 * A square 8-bit grayscale PNG from `side * side` pixel bytes, row by row.
 * Level 0 keeps random pixels at full size, as the Python fixtures do.
 */
export const buildGrayPng = (
  side: number,
  pixels: Uint8Array,
  compressionLevel = 6,
): Buffer => {
  if (pixels.length !== side * side) {
    throw new Error(`expected ${side * side} pixels, got ${pixels.length}`);
  }
  const rows = Array.from({ length: side }, (_, row) =>
    Buffer.concat([
      Buffer.from([NO_FILTER]),
      pixels.subarray(row * side, (row + 1) * side),
    ]),
  );
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header(side)),
    chunk(
      'IDAT',
      deflateSync(Buffer.concat(rows), { level: compressionLevel }),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};
