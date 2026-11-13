import { encodeText, JAPANESE_SAMPLE } from '../../../test/fixtures';
import { plainToText } from './plain-text';

describe('plainToText (test_text.py, plain)', () => {
  it('returns Shift_JIS text decoded and otherwise unchanged', () => {
    expect(plainToText(encodeText(JAPANESE_SAMPLE, 'shift_jis'))).toBe(
      JAPANESE_SAMPLE,
    );
  });

  it('strips the UTF-8 BOM', () => {
    expect(plainToText(encodeText(JAPANESE_SAMPLE, 'utf-8-bom'))).toBe(
      JAPANESE_SAMPLE,
    );
  });

  it('decodes EUC-JP', () => {
    expect(plainToText(encodeText(JAPANESE_SAMPLE, 'euc-jp'))).toBe(
      JAPANESE_SAMPLE,
    );
  });

  it('does not parse JSON or YAML', () => {
    const nested = `${'['.repeat(100_000)}${']'.repeat(100_000)}`;
    expect(plainToText(Buffer.from(nested))).toBe(nested);
    const bomb = 'a: &a [x,x]\nb: &b [*a,*a]\nc: [*b,*b]\n';
    expect(plainToText(Buffer.from(bomb))).toBe(bomb);
  });

  it('returns an empty string for an empty file', () => {
    expect(plainToText(new Uint8Array(0))).toBe('');
  });

  it('returns a string for binary garbage instead of throwing', () => {
    const garbage = Buffer.from(
      Array.from({ length: 2560 }, (_, i) => i % 256),
    );
    expect(typeof plainToText(garbage)).toBe('string');
  });

  it('never lets a lone surrogate reach the result', () => {
    const data = Buffer.concat([
      Buffer.from('{"k": "\\ud800"} '),
      Buffer.from([0xed, 0xa0, 0x80]),
    ]);
    expect(plainToText(data).isWellFormed()).toBe(true);
  });
});
