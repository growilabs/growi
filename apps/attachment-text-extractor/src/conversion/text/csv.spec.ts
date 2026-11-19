import { encodeText } from '../../../test/fixtures';
import { ConversionError } from '../conversion-error';
import { csvToText } from './csv';

describe('csvToText (test_text.py, CSV / TSV)', () => {
  it('converts CSV to a Markdown table', async () => {
    expect(await csvToText(Buffer.from('a,b\n1,2\n'))).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n',
    );
  });

  it('decodes Shift_JIS CSV without mojibake', async () => {
    const data = encodeText('名前,年齢\n太郎,3\n', 'shift_jis');
    expect(await csvToText(data)).toBe(
      '| 名前 | 年齢 |\n| --- | --- |\n| 太郎 | 3 |\n',
    );
  });

  it('keeps the UTF-8 BOM out of the first header', async () => {
    const out = await csvToText(encodeText('名前,年齢\n太郎,3\n', 'utf-8-bom'));
    expect(out.startsWith('| 名前 |')).toBe(true);
  });

  it('keeps the columns of TSV fields holding commas and quotes', async () => {
    const data = Buffer.from('a\tb\tc\n1,2\t"say ""hi"""\t3\n');
    expect(await csvToText(data)).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| 1,2 | say "hi" | 3 |\n',
    );
  });

  it('returns an empty string for an empty file', async () => {
    expect(await csvToText(new Uint8Array(0))).toBe('');
  });

  it('lets nothing but a ConversionError escape for binary garbage', async () => {
    const garbage = Buffer.from(
      Array.from({ length: 2560 }, (_, i) => i % 256),
    );
    const result = await csvToText(garbage).catch((error: unknown) => error);
    expect(
      typeof result === 'string' || result instanceof ConversionError,
    ).toBe(true);
  });

  it('never lets a lone surrogate reach the result', async () => {
    const data = Buffer.concat([
      Buffer.from('a,b\n'),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from(',2\n'),
    ]);
    expect((await csvToText(data)).isWellFormed()).toBe(true);
  });
});
