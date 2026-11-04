import iconv from 'iconv-lite';

import { encodeIso2022Jp } from './iso-2022-jp';

export type TextEncodingName =
  | 'shift_jis'
  | 'cp932'
  | 'euc-jp'
  | 'iso-2022-jp'
  | 'cp1252'
  | 'koi8-r'
  | 'utf-8-bom'
  | 'utf-16le-bom'
  | 'utf-16be-bom'
  | 'utf-32le-bom'
  | 'utf-32be-bom';

// Node cannot encode legacy charsets itself (TextEncoder is UTF-8 only).
// iconv-lite's Shift_JIS uses the cp932 table, unlike Python's shift_jis: it
// accepts ① 髙 ㈱ ～ and refuses 〜 − ¥ ‾ (EUC-JP too refuses 〜), so 〜 cannot
// appear in Shift_JIS, EUC-JP or ISO-2022-JP text here.
const encodeWithIconv =
  (iconvName: string) =>
  (text: string): Buffer => {
    const bytes = iconv.encode(text, iconvName);
    // iconv-lite writes '?' for an unmappable character instead of failing.
    if (iconv.decode(bytes, iconvName) !== text) {
      throw new Error(`text is not representable in ${iconvName}`);
    }
    return bytes;
  };

const swapByteOrder16 = (bytes: Buffer): Buffer => Buffer.from(bytes).swap16();

const utf32 =
  (order: 'LE' | 'BE') =>
  (text: string): Buffer => {
    const codePoints = [
      0xfeff,
      ...[...text].map((char) => char.codePointAt(0) ?? 0),
    ];
    const bytes = Buffer.alloc(codePoints.length * 4);
    codePoints.forEach((codePoint, i) => {
      if (order === 'LE') {
        bytes.writeUInt32LE(codePoint, i * 4);
      } else {
        bytes.writeUInt32BE(codePoint, i * 4);
      }
    });
    return bytes;
  };

const ENCODERS: Record<TextEncodingName, (text: string) => Buffer> = {
  shift_jis: encodeWithIconv('Shift_JIS'),
  cp932: encodeWithIconv('cp932'),
  'euc-jp': encodeWithIconv('EUC-JP'),
  'iso-2022-jp': encodeIso2022Jp,
  cp1252: encodeWithIconv('cp1252'),
  'koi8-r': encodeWithIconv('koi8-r'),
  'utf-8-bom': (text) => Buffer.from(`\ufeff${text}`, 'utf8'),
  'utf-16le-bom': (text) => Buffer.from(`\ufeff${text}`, 'utf16le'),
  'utf-16be-bom': (text) =>
    swapByteOrder16(Buffer.from(`\ufeff${text}`, 'utf16le')),
  'utf-32le-bom': utf32('LE'),
  'utf-32be-bom': utf32('BE'),
};

/** Encodes text, throwing when a character cannot be represented. */
export const encodeText = (text: string, encoding: TextEncodingName): Buffer =>
  ENCODERS[encoding](text);
