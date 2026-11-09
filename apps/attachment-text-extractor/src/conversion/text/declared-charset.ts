import { ASCII_ONLY } from './strict-decode';

// Python codec names that are not WHATWG labels.
const PYTHON_ALIASES: Readonly<Record<string, string>> = {
  cp932: 'shift_jis',
  ms932: 'shift_jis',
  windows_31j: 'shift_jis',
  euc_jp: 'euc-jp',
  eucjp: 'euc-jp',
  ujis: 'euc-jp',
  iso2022_jp: 'iso-2022-jp',
  cp1252: 'windows-1252',
};

// A hostile declaration must not pick these: "replacement" turns the whole
// input into one U+FFFD, x-user-defined maps every high byte to private use,
// and UTF-16 without a BOM is never what an ASCII-readable declaration means.
const UNUSABLE_ENCODINGS: ReadonlySet<string> = new Set([
  'replacement',
  'x-user-defined',
  'utf-16le',
  'utf-16be',
]);

// WHATWG labels of windows-1252 that Python resolves to its strict ascii codec.
const ASCII_LABELS: ReadonlySet<string> = new Set([
  'ascii',
  'us-ascii',
  'ansi_x3.4-1968',
  'us',
  'iso646-us',
  'cp367',
  'csascii',
]);

const whatwgEncodingOf = (label: string): string | null => {
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return null;
  }
};

/** The decoder label for a declared charset name, or null when it must not be used. */
export const resolveDeclared = (name: string): string | null => {
  const raw = name.trim().toLowerCase();
  if (ASCII_LABELS.has(raw)) {
    return ASCII_ONLY;
  }
  const candidates = [
    raw,
    PYTHON_ALIASES[raw.replaceAll('-', '_')],
    raw.replaceAll('_', '-'),
  ];
  for (const label of candidates) {
    const encoding = label ? whatwgEncodingOf(label) : null;
    if (encoding !== null) {
      return UNUSABLE_ENCODINGS.has(encoding) ? null : encoding;
    }
  }
  return null;
};

type ByteRange = readonly [number, number];
type FitsBytes = (bytes: Uint8Array) => boolean;

const inRange = (b: number | undefined, [lo, hi]: ByteRange): boolean =>
  b !== undefined && b >= lo && b <= hi;

const fitsDoubleByte =
  (lead: ByteRange, trails: readonly ByteRange[]): FitsBytes =>
  (bytes) => {
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] < 0x80) {
        continue;
      }
      const trail = bytes[i + 1];
      if (
        !inRange(bytes[i], lead) ||
        !trails.some((range) => inRange(trail, range))
      ) {
        return false;
      }
      i += 1;
    }
    return true;
  };

// Python's shift_jis is JIS X 0208 only. WHATWG Shift_JIS also reads the NEC
// row 13 (lead 0x87), the NEC-selected and IBM rows (0xED, 0xEE, 0xFA-0xFC)
// and the user-defined rows (0xF0-0xF9, private use), so a document wrongly
// declared Shift_JIS (EUC-JP bytes, say) would decode as mojibake instead of
// falling to detection as it does in Python.
const fitsJisX0208ShiftJis: FitsBytes = (bytes) => {
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b < 0x80 || (b >= 0xa1 && b <= 0xdf)) {
      continue;
    }
    if (b === 0x87 || b === 0xed || b === 0xee || b >= 0xf0) {
      return false;
    }
    i += 1;
  }
  return true;
};

// Python's codecs behind these names are narrower than the WHATWG decoders
// (gb2312 vs GBK, euc_kr vs windows-949, big5 vs Big5-HKSCS, shift_jis vs
// WHATWG Shift_JIS): bytes outside Python's ranges make Python reject the
// declaration and fall to detection.
const GB2312 = fitsDoubleByte([0xa1, 0xf7], [[0xa1, 0xfe]]);
const EUC_KR = fitsDoubleByte([0xa1, 0xfe], [[0xa1, 0xfe]]);
const BIG5 = fitsDoubleByte(
  [0xa1, 0xf9],
  [
    [0x40, 0x7e],
    [0xa1, 0xfe],
  ],
);
const PYTHON_NARROWER: ReadonlyMap<string, FitsBytes> = new Map([
  ['chinese', GB2312],
  ['csiso58gb231280', GB2312],
  ['gb2312', GB2312],
  ['iso-ir-58', GB2312],
  ['euc-kr', EUC_KR],
  ['korean', EUC_KR],
  ['ks-c-5601-1987', EUC_KR],
  ['ksc5601', EUC_KR],
  ['big5', BIG5],
  ['csbig5', BIG5],
  ['shift-jis', fitsJisX0208ShiftJis],
  ['sjis', fitsJisX0208ShiftJis],
  ['csshiftjis', fitsJisX0208ShiftJis],
]);

/** False when Python's codec for the declared name would reject these bytes. */
export const fitsPythonCodec = (name: string, bytes: Uint8Array): boolean =>
  PYTHON_NARROWER.get(name.trim().toLowerCase().replaceAll('_', '-'))?.(
    bytes,
  ) ?? true;
