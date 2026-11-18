import { encodeIso2022Jp } from './iso-2022-jp';

const SAMPLE = '障害対応メモ\n本番環境で発生した情報システムの障害';

describe('encodeIso2022Jp', () => {
  it('writes text that a standard ISO-2022-JP decoder turns back into the same text', () => {
    const bytes = encodeIso2022Jp(SAMPLE);

    expect(new TextDecoder('iso-2022-jp').decode(bytes)).toBe(SAMPLE);
  });

  it('writes the same bytes as Python iso2022_jp', () => {
    // Expected bytes from Python: SAMPLE.encode("iso2022_jp") and
    // "ABC日本語def".encode("iso2022_jp").
    expect(encodeIso2022Jp(SAMPLE).toString('hex')).toBe(
      '1b24423e6333324250317e256125621b28420a1b24424b5c48563444362d2447482f' +
        '40382437243f3e704a732537253925462560244e3e6333321b2842',
    );
    expect(encodeIso2022Jp('ABC日本語def').toString('hex')).toBe(
      '4142431b2442467c4b5c386c1b2842646566',
    );
  });

  it('writes ASCII without any escape sequence', () => {
    expect(encodeIso2022Jp('plain ascii\r\n').toString('latin1')).toBe(
      'plain ascii\r\n',
    );
  });

  it.each([
    ['WAVE DASH', '〜'],
    ['FULLWIDTH TILDE', '～'],
    ['NEC circled digit', '①'],
    ['IBM extension kanji', '髙'],
    ['emoji', '😀'],
  ])('refuses a character outside JIS X 0208 (%s) instead of writing "?"', (_, character) => {
    expect(() => encodeIso2022Jp(`前${character}後`)).toThrow();
  });
});
