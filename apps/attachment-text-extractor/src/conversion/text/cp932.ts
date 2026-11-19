// Python's cp932 maps these five single bytes; WHATWG Shift_JIS rejects them,
// so one of them would otherwise hand the whole text to windows-1252.
const CP932_SINGLE_BYTES: ReadonlyMap<number, string> = new Map([
  [0x80, '\u0080'],
  [0xa0, '\uf8f0'],
  [0xfd, '\uf8f1'],
  [0xfe, '\uf8f2'],
  [0xff, '\uf8f3'],
]);

// A decoder, a concatenation or an array entry per stray byte costs 40-70 MiB
// per MB of input, so runs are joined in batches of this many pieces.
const BATCH_PIECES = 4096;

const isLeadByte = (b: number): boolean =>
  (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xfc);

/**
 * Reads bytes the way Python's cp932 codec does; null when they do not decode.
 * stream: the bytes may end inside a character (a detection sample).
 */
export const decodeCp932 = (
  bytes: Uint8Array,
  stream = false,
): string | null => {
  const decoder = new TextDecoder('shift_jis', { fatal: true });
  const batches: string[] = [];
  let pieces: string[] = [];
  let runStart = 0;
  try {
    for (let i = 0; i < bytes.length; ) {
      const single = CP932_SINGLE_BYTES.get(bytes[i]);
      if (single === undefined) {
        i += isLeadByte(bytes[i]) ? 2 : 1;
        continue;
      }
      pieces.push(decoder.decode(bytes.subarray(runStart, i)), single);
      i += 1;
      runStart = i;
      if (pieces.length >= BATCH_PIECES) {
        batches.push(pieces.join(''));
        pieces = [];
      }
    }
    pieces.push(decoder.decode(bytes.subarray(runStart), { stream }));
  } catch {
    return null;
  }
  batches.push(pieces.join(''));
  return batches.join('');
};
