import { encodeText, type TextEncodingName } from './text-encoding';

const SAMPLE = '障害対応メモ\n本番環境で発生した情報システムの障害';

describe('encodeText', () => {
  it.each<[TextEncodingName, string, string]>([
    ['shift_jis', 'shift_jis', SAMPLE],
    ['cp932', 'shift_jis', '①②③ ㈱テスト 髙橋'],
    ['euc-jp', 'euc-jp', SAMPLE],
    ['iso-2022-jp', 'iso-2022-jp', SAMPLE],
    ['utf-8-bom', 'utf-8', SAMPLE],
    ['utf-16le-bom', 'utf-16le', SAMPLE],
    ['utf-16be-bom', 'utf-16be', SAMPLE],
    ['cp1252', 'windows-1252', 'café “quoted” €'],
    ['koi8-r', 'koi8-r', 'Привет, мир'],
  ])('writes %s that a standard decoder (%s) turns back into the text', (encoding, label, text) => {
    const bytes = encodeText(text, encoding);

    expect(new TextDecoder(label).decode(bytes)).toBe(text);
  });

  it.each<[TextEncodingName, string]>([
    ['utf-8-bom', 'efbbbf'],
    ['utf-16le-bom', 'fffe'],
    ['utf-16be-bom', 'feff'],
    ['utf-32le-bom', 'fffe0000'],
    ['utf-32be-bom', '0000feff'],
  ])('starts %s with its byte order mark', (encoding, bom) => {
    expect(encodeText('x', encoding).toString('hex').startsWith(bom)).toBe(
      true,
    );
  });

  it.each<['utf-32le-bom' | 'utf-32be-bom', 'LE' | 'BE']>([
    ['utf-32le-bom', 'LE'],
    ['utf-32be-bom', 'BE'],
  ])('writes %s as one 4-byte code point per character', (encoding, order) => {
    const text = 'aあ😀';

    const bytes = encodeText(text, encoding).subarray(4);
    const codePoints = Array.from({ length: bytes.length / 4 }, (_, i) =>
      order === 'LE' ? bytes.readUInt32LE(i * 4) : bytes.readUInt32BE(i * 4),
    );

    expect(String.fromCodePoint(...codePoints)).toBe(text);
  });

  it('writes the same Shift_JIS and EUC-JP bytes as Python for the Japanese sample', () => {
    // Expected bytes from Python: SAMPLE.encode("shift_jis") / ("euc_jp").
    expect(encodeText(SAMPLE, 'shift_jis').toString('hex')).toBe(
      '8fe18a5191ce899e838183820a967b94d48ac28bab82c594ad90b682b582bd8fee95f1' +
        '835683588365838082cc8fe18a51',
    );
    expect(encodeText(SAMPLE, 'euc-jp').toString('hex')).toBe(
      'bee3b3b2c2d0b1fea5e1a5e20acbdcc8d6b4c4b6ada4c7c8afc0b8a4b7a4bfbef0caf3' +
        'a5b7a5b9a5c6a5e0a4cebee3b3b2',
    );
  });

  it.each<[TextEncodingName, string]>([
    ['shift_jis', '😀'],
    ['euc-jp', '😀'],
    ['cp1252', '日'],
    ['koi8-r', '日'],
  ])('refuses a character %s cannot represent instead of writing "?"', (encoding, character) => {
    expect(() => encodeText(`a${character}b`, encoding)).toThrow();
  });
});
