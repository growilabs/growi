import { encodeText, type TextEncodingName } from '../../../test/fixtures';
import { decodeText } from './charset';

const LONG_JA =
  '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。'.repeat(
    3,
  );
const SHORT_JA = '会議資料';
const SHORT_JA_SENTENCE = '日本語のテスト';
const GERMAN = 'Grüße aus München, café, naïve';
const MEETING_JA = '経営企画会議の議事録を共有します。';

// The non-ASCII letters of GERMAN share one code point in cp437 and cp850.
const CP437_AND_CP850: Readonly<Record<string, number>> = {
  ü: 0x81,
  ß: 0xe1,
  é: 0x82,
  ï: 0x8b,
};

const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8');
const bytes = (...parts: readonly (Uint8Array | number[])[]): Buffer =>
  Buffer.concat(parts.map((part) => Buffer.from(part)));

describe('decodeText (test_charset.py)', () => {
  it.each([
    ['long Japanese', LONG_JA],
    ['short Japanese', SHORT_JA],
    ['ASCII', 'plain ascii'],
    ['Latin accents', 'café ünï'],
  ])('decodes UTF-8 without a BOM: %s', (_name, text) => {
    expect(decodeText(utf8(text))).toBe(text);
  });

  it('strips the UTF-8 BOM', () => {
    expect(decodeText(encodeText(LONG_JA, 'utf-8-bom'))).toBe(LONG_JA);
  });

  it.each<TextEncodingName>([
    'utf-16le-bom',
    'utf-16be-bom',
  ])('decodes UTF-16 with a BOM: %s', (encoding) => {
    expect(decodeText(encodeText(LONG_JA, encoding))).toBe(LONG_JA);
  });

  it.each([
    ['long', LONG_JA],
    ['short word', SHORT_JA],
    ['short sentence', SHORT_JA_SENTENCE],
  ])('detects Shift_JIS, including short samples: %s', (_name, text) => {
    expect(decodeText(encodeText(text, 'cp932'))).toBe(text);
  });

  it('detects Shift_JIS with cp932 extension characters', () => {
    const text = '①②③ ㈱テスト 髙橋';
    expect(decodeText(encodeText(text, 'cp932'))).toBe(text);
  });

  it.each([
    ['long', LONG_JA],
    ['short sentence', SHORT_JA_SENTENCE],
  ])('detects EUC-JP: %s', (_name, text) => {
    expect(decodeText(encodeText(text, 'euc-jp'))).toBe(text);
  });

  it.each([
    ['long', LONG_JA],
    ['short sentence', SHORT_JA_SENTENCE],
  ])('detects ISO-2022-JP: %s', (_name, text) => {
    expect(decodeText(encodeText(text, 'iso-2022-jp'))).toBe(text);
  });

  it('detects cp1252', () => {
    const text = 'Price: €5 – “quoted” café résumé naïve';
    expect(decodeText(encodeText(text, 'cp1252'))).toBe(text);
  });

  it('decodes empty bytes to an empty string', () => {
    expect(decodeText(new Uint8Array(0))).toBe('');
  });

  it('uses the declared charset over detection', () => {
    const html = `<html><head><meta charset="shift_jis"></head><body>${LONG_JA}</body></html>`;
    expect(decodeText(encodeText(html, 'cp932'), 'shift_jis')).toBe(html);
  });

  it('resolves an alias of the declared charset', () => {
    const html = `<p>${SHORT_JA}</p>`;
    expect(decodeText(encodeText(html, 'euc-jp'), 'EUC-JP')).toBe(html);
  });

  it('reads the declared charset case-insensitively', () => {
    expect(decodeText(encodeText(SHORT_JA, 'cp932'), 'Shift_JIS')).toBe(
      SHORT_JA,
    );
  });

  it('falls back to detection for an unknown declared charset', () => {
    expect(decodeText(utf8(LONG_JA), 'no-such-charset')).toBe(LONG_JA);
  });

  it('falls back to detection when the declared charset cannot decode the bytes', () => {
    expect(decodeText(utf8(LONG_JA), 'ascii')).toBe(LONG_JA);
  });

  it('lets the BOM win over the declared charset', () => {
    expect(decodeText(encodeText(LONG_JA, 'utf-8-bom'), 'shift_jis')).toBe(
      LONG_JA,
    );
  });

  it('falls back to latin-1 for bytes no candidate decodes', () => {
    const data = bytes(
      [0x81, 0x00, 0xff, 0xfe, 0x80, 0x81, 0x82],
      utf8(' abc'),
    );
    expect(decodeText(data)).toBe(data.toString('latin1'));
  });

  it.each([
    '\x00',
    'undefined',
  ])('ignores a malformed declared charset: %j', (declared) => {
    expect(decodeText(utf8('abc'), declared)).toBe('abc');
    expect(decodeText(encodeText(SHORT_JA, 'cp932'), declared)).toBe(SHORT_JA);
  });

  it.each([
    'unicode_escape',
    'raw_unicode_escape',
    'undefined',
    'rot13',
    'hex',
    'base64',
    'zlib',
    'punycode',
    'idna',
    'utf_7',
  ])('ignores a declared codec that is not a charset: %s', (declared) => {
    expect(decodeText(encodeText(SHORT_JA_SENTENCE, 'cp932'), declared)).toBe(
      SHORT_JA_SENTENCE,
    );
    expect(decodeText(encodeText(LONG_JA, 'cp932'), declared)).toBe(LONG_JA);
  });

  it.each([
    ['short word', SHORT_JA],
    ['short sentence', SHORT_JA_SENTENCE],
  ])('detects short EUC-JP and ISO-2022-JP: %s', (_name, text) => {
    expect(decodeText(encodeText(text, 'euc-jp'))).toBe(text);
    expect(decodeText(encodeText(text, 'iso-2022-jp'))).toBe(text);
  });

  it('leaves UTF-8 containing escape sequences unchanged', () => {
    const text = 'ansi \x1b[31mred\x1b[0m $B (J \x1b$B literal \x1b(J 日本語';
    expect(decodeText(utf8(text))).toBe(text);
    const plain = '\x1b[1mbold\x1b[0m ascii only';
    expect(decodeText(utf8(plain))).toBe(plain);
  });

  it.each<TextEncodingName>([
    'utf-32le-bom',
    'utf-32be-bom',
  ])('decodes UTF-32 with a BOM: %s', (encoding) => {
    expect(decodeText(encodeText(LONG_JA, encoding))).toBe(LONG_JA);
  });

  it('detects cp1252 longer than a sentence', () => {
    const text =
      'The “quarterly” report shows revenue of €1,250,000 – up 12% – and the café’s résumé of naïve forecasts was ‘rejected’. '.repeat(
        3,
      );
    expect(decodeText(encodeText(text, 'cp1252'))).toBe(text);
  });
});

// Inputs added by research.md 18.10 / 18.5.2; the expected values are what the
// Python service's decode() returned for the same bytes.
describe('decodeText: hostile and narrow declarations, same result as the Python service', () => {
  it.each([
    ['iso-2022-kr', 'cp932'],
    ['iso-2022-kr', 'utf-8'],
    ['hz-gb-2312', 'cp932'],
    ['hz-gb-2312', 'utf-8'],
    ['csiso2022kr', 'cp932'],
    ['csiso2022kr', 'utf-8'],
    ['iso-2022-cn', 'cp932'],
    ['iso-2022-cn', 'utf-8'],
    ['iso-2022-cn-ext', 'cp932'],
    ['iso-2022-cn-ext', 'utf-8'],
    ['replacement', 'cp932'],
    ['replacement', 'utf-8'],
    ['x-user-defined', 'cp932'],
    ['x-user-defined', 'utf-8'],
    ['utf-16le', 'cp932'],
    ['utf-16le', 'utf-8'],
    ['utf-16be', 'utf-8'],
  ] as const)('never lets a declared %s turn %s text into one replacement character or private-use text', (declared, encoding) => {
    const data =
      encoding === 'utf-8' ? utf8(LONG_JA) : encodeText(LONG_JA, encoding);
    expect(decodeText(data, declared)).toBe(LONG_JA);
  });

  it.each([
    'us-ascii',
    'ansi_x3.4-1968',
    'csascii',
    'ASCII',
  ])('falls back to detection when an ASCII label %s is declared over UTF-8 Japanese', (declared) => {
    expect(decodeText(utf8(LONG_JA), declared)).toBe(LONG_JA);
  });

  it('uses a declared ASCII label when the bytes are ASCII', () => {
    expect(decodeText(utf8('plain ascii'), 'ascii')).toBe('plain ascii');
  });

  it.each([
    ['declared windows-1252', 'windows-1252'],
    ['no declaration', null],
  ])('treats the five bytes cp1252 leaves undefined as undecodable (%s): falls back to latin-1', (_name, declared) => {
    const data = bytes(
      encodeText('Price: €5 – “quoted” café résumé naïve', 'cp1252'),
      [0x81],
    );
    expect(decodeText(data, declared)).toBe(data.toString('latin1'));
  });

  // Python's cp932 reads these single bytes, WHATWG Shift_JIS rejects them.
  it.each([
    [0x80, '\u0080'],
    [0xa0, ''],
    [0xfd, ''],
    [0xfe, ''],
    [0xff, ''],
  ])('reads Shift_JIS with a lone 0x%s byte as cp932 instead of garbling the whole text', (byte, char) => {
    const sjis = encodeText(LONG_JA, 'cp932');
    const middle = Math.floor(sjis.length / 2 / 2) * 2;
    const data = bytes(sjis.subarray(0, middle), [byte], sjis.subarray(middle));
    expect(decodeText(data)).toBe(
      `${LONG_JA.slice(0, middle / 2)}${char}${LONG_JA.slice(middle / 2)}`,
    );
  });

  it('reads a declared Shift_JIS document ending in bytes WHATWG rejects as cp932', () => {
    const html = `<html><head><meta charset="shift_jis"></head><body>${LONG_JA}</body></html>`;
    const data = bytes(encodeText(html, 'cp932'), [0xff, 0xfe, 0x80]);
    expect(decodeText(data, 'shift_jis')).toBe(`${html}\u0080`);
  });

  it.each([
    'gb2312',
    'chinese',
    'csiso58gb231280',
    'iso-ir-58',
    'euc-kr',
    'korean',
    'ks_c_5601-1987',
    'ksc5601',
    'big5',
    'csbig5',
  ])('ignores a declared %s whose Python codec rejects the Shift_JIS bytes, and detects Shift_JIS', (declared) => {
    expect(decodeText(encodeText(LONG_JA, 'cp932'), declared)).toBe(LONG_JA);
  });

  it.each([
    ['1252', GERMAN, 'cp1252'],
    ['latin9', GERMAN, 'cp1252'],
    ['shiftjis', MEETING_JA, 'cp932'],
    ['s-jis', MEETING_JA, 'cp932'],
    ['ms-kanji', MEETING_JA, 'cp932'],
    ['x-mac-japanese', MEETING_JA, 'cp932'],
    ['shift_jis_2004', MEETING_JA, 'cp932'],
    ['u-jis', MEETING_JA, 'euc-jp'],
    ['euc_jis_2004', MEETING_JA, 'euc-jp'],
    ['iso2022_jp_2', MEETING_JA, 'iso-2022-jp'],
  ] as const)('recovers through detection when %s, a Python codec name WHATWG lacks, is declared', (declared, text, encoding) => {
    expect(decodeText(encodeText(text, encoding), declared)).toBe(text);
  });
});

// Req 2.3: recorded differences (research.md 18.7). The Python service returns
// something else for these inputs; the names say what Python does and why.
describe('decodeText: Node-only expectations, Python differs (research.md 18.7)', () => {
  it.each([
    ['〜 (U+301C)', [0xa1, 0xc1], '～'],
    ['‖ (U+2016)', [0xa1, 0xc2], '∥'],
    ['− (U+2212)', [0xa1, 0xdd], '－'],
    ['¢', [0xa1, 0xf1], '￠'],
    ['£', [0xa1, 0xf2], '￡'],
    ['¬', [0xa2, 0xcc], '￢'],
  ])('reads EUC-JP %s with the WHATWG table (Python keeps the JIS character; 18.7-1, no effect on search)', (_python, code, whatwg) => {
    const data = bytes(
      encodeText('9時', 'euc-jp'),
      code,
      encodeText('18時', 'euc-jp'),
    );
    expect(decodeText(data, 'EUC-JP')).toBe(`9時${whatwg}18時`);
  });

  it.each([
    'iso-8859-1',
    'latin1',
  ])('reads a declared %s as windows-1252, as browsers do (Python reads latin-1 and yields U+0080; 18.7-2)', (declared) => {
    expect(decodeText(encodeText('Price €5', 'cp1252'), declared)).toBe(
      'Price €5',
    );
  });

  it('never uses a declared UTF-16, so Shift_JIS bytes are detected (Python decodes them as UTF-16BE mojibake; 18.7-4)', () => {
    expect(decodeText(encodeText(LONG_JA, 'cp932'), 'utf-16be')).toBe(LONG_JA);
  });

  it.each([
    'cp437',
    'cp850',
  ])('keeps at least the ASCII text under a declared DOS code page %s, which WHATWG has no decoder for (Python decodes it; 18.7-10)', (declared) => {
    const data = Buffer.from(
      [...GERMAN].map((char) => CP437_AND_CP850[char] ?? char.charCodeAt(0)),
    );
    const decoded = decodeText(data, declared);
    expect(decoded).toContain('aus M');
    expect(decoded).toContain('nchen, caf');
  });
});

// Req 2.6 known limitation, kept on purpose: without a BOM or a declaration,
// UTF-16 is not recognised, so the text comes back garbled (the Python service
// too: charset-normalizer returned neither the Japanese nor the ASCII text for
// LE or BE). The check is "not the original" rather than a fixed garbled
// string, which depends on the detector. If a change makes this pass no
// longer, the limitation has changed: record it in research.md (Req 2.6).
describe('decodeText: known limitation, UTF-16 without a BOM is not recognised (Req 2.6)', () => {
  const utf16be = (text: string): Buffer =>
    Buffer.from(text, 'utf16le').swap16();

  it.each([
    [
      'Japanese, little-endian',
      LONG_JA,
      (text: string) => Buffer.from(text, 'utf16le'),
    ],
    ['Japanese, big-endian', LONG_JA, utf16be],
    [
      'ASCII, little-endian',
      'plain ascii text for the known limitation',
      (text: string) => Buffer.from(text, 'utf16le'),
    ],
    ['ASCII, big-endian', 'plain ascii text for the known limitation', utf16be],
  ])('does not give back the original text: %s', (_case, text, encode) => {
    expect(decodeText(encode(text))).not.toBe(text);
  });
});
