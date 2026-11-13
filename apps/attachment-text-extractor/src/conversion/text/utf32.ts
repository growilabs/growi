const BOM_BYTES = 4;
// Code points per String.fromCodePoint call: one call per character would
// build millions of intermediate strings for a large file.
const CHUNK_CODE_POINTS = 4096;

const isScalarValue = (cp: number): boolean =>
  cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);

/** Decodes UTF-32 after its 4-byte BOM (TextDecoder has no UTF-32); null when the bytes are not valid UTF-32. */
export const decodeUtf32AfterBom = (
  bytes: Uint8Array,
  littleEndian: boolean,
): string | null => {
  if (bytes.length % 4 !== 0) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: string[] = [];
  let codePoints: number[] = [];
  for (let at = BOM_BYTES; at < bytes.length; at += 4) {
    const cp = view.getUint32(at, littleEndian);
    if (!isScalarValue(cp)) {
      return null;
    }
    codePoints.push(cp);
    if (codePoints.length === CHUNK_CODE_POINTS) {
      chunks.push(String.fromCodePoint(...codePoints));
      codePoints = [];
    }
  }
  chunks.push(String.fromCodePoint(...codePoints));
  return chunks.join('');
};
