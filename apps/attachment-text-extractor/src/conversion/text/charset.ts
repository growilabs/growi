import { decodeCp932 } from './cp932';
import { fitsPythonCodec, resolveDeclared } from './declared-charset';
import { detectCharset } from './detect-charset';
import { decodeLatin1, strictDecode } from './strict-decode';
import { decodeUtf32AfterBom } from './utf32';

type Decode = (bytes: Uint8Array) => string | null;

// UTF-32 BOMs begin with the UTF-16 LE BOM, so they are tried first; when a
// UTF-32 decode fails, the UTF-16 one is still tried, as in Python.
const BOM_DECODERS: readonly (readonly [readonly number[], Decode])[] = [
  [[0xef, 0xbb, 0xbf], (bytes) => strictDecode('utf-8', bytes)],
  [[0xff, 0xfe, 0x00, 0x00], (bytes) => decodeUtf32AfterBom(bytes, true)],
  [[0x00, 0x00, 0xfe, 0xff], (bytes) => decodeUtf32AfterBom(bytes, false)],
  [[0xff, 0xfe], (bytes) => strictDecode('utf-16le', bytes)],
  [[0xfe, 0xff], (bytes) => strictDecode('utf-16be', bytes)],
];

// Checked before strict UTF-8: ISO-2022-JP is pure 7-bit, so UTF-8 would
// accept it and leave the escape sequences in the text.
const ESC = 0x1b;
// The two bytes after ESC in the escapes ESC $ B, ESC $ @ and ESC ( J.
const ISO2022JP_DESIGNATIONS: readonly (readonly [number, number])[] = [
  [0x24, 0x42],
  [0x24, 0x40],
  [0x28, 0x4a],
];

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((b, i) => bytes[i] === b);

const hasIso2022JpEscape = (bytes: Uint8Array): boolean => {
  for (let at = bytes.indexOf(ESC); at >= 0; at = bytes.indexOf(ESC, at + 1)) {
    const first = bytes[at + 1];
    const second = bytes[at + 2];
    for (const [a, b] of ISO2022JP_DESIGNATIONS) {
      if (first === a && second === b) {
        return true;
      }
    }
  }
  return false;
};

const decodeByBom: Decode = (bytes) => {
  for (const [bom, decode] of BOM_DECODERS) {
    const text = startsWith(bytes, bom) ? decode(bytes) : null;
    if (text !== null) {
      return text;
    }
  }
  return null;
};

const decodeDeclared = (
  bytes: Uint8Array,
  declared: string | null | undefined,
): string | null => {
  if (!declared || !fitsPythonCodec(declared, bytes)) {
    return null;
  }
  const label = resolveDeclared(declared);
  return label === null ? null : strictDecode(label, bytes);
};

const decodeIso2022Jp: Decode = (bytes) =>
  hasIso2022JpEscape(bytes) ? strictDecode('iso-2022-jp', bytes) : null;

const decodeDetected: Decode = (bytes) => {
  const guess = detectCharset(bytes);
  return guess === null ? null : strictDecode(guess, bytes);
};

/**
 * BOM -> declared charset -> ISO-2022-JP escapes -> strict UTF-8 -> detection
 * among Shift_JIS / EUC-JP / windows-1252 -> cp932 -> latin-1 (never fails).
 */
export const decodeText = (
  bytes: Uint8Array,
  declared?: string | null,
): string =>
  decodeByBom(bytes) ??
  decodeDeclared(bytes, declared) ??
  decodeIso2022Jp(bytes) ??
  strictDecode('utf-8', bytes) ??
  decodeDetected(bytes) ??
  decodeCp932(bytes) ??
  decodeLatin1(bytes);
