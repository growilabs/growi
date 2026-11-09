/** Not a WHATWG label: Python's strict ascii codec, which WHATWG maps to windows-1252. */
export const ASCII_ONLY = 'x-ascii';

// Python's cp1252 leaves these five bytes undefined; WHATWG windows-1252 maps
// them to C1 controls and never fails.
const CP1252_UNDEFINED = [0x81, 0x8d, 0x8f, 0x90, 0x9d] as const;

const isAscii = (bytes: Uint8Array): boolean => bytes.every((b) => b < 0x80);

/** Decodes with Python-strict semantics on top of WHATWG decoders; null when the bytes do not fit. */
export const strictDecode = (
  label: string,
  bytes: Uint8Array,
): string | null => {
  if (label === ASCII_ONLY) {
    return isAscii(bytes) ? new TextDecoder().decode(bytes) : null;
  }
  if (
    label === 'windows-1252' &&
    CP1252_UNDEFINED.some((b) => bytes.includes(b))
  ) {
    return null;
  }
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** Python's latin-1: every byte is the code point of the same value (WHATWG's "latin1" is windows-1252). */
export const decodeLatin1 = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    'latin1',
  );
