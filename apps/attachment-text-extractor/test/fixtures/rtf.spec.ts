import { buildRtf } from './rtf';
import { anydocMarkdown } from './spec-support';

describe('buildRtf', () => {
  it('writes an ASCII-only RTF document', () => {
    const rtf = buildRtf('日本語 and 😀');

    expect(rtf.toString('latin1').startsWith('{\\rtf1')).toBe(true);
    expect(rtf.every((byte) => byte < 0x80)).toBe(true);
  });

  it('writes text, line by line, that anydoc extracts', async () => {
    const markdown = await anydocMarkdown(
      buildRtf('first line\n障害対応メモ'),
      'rtf',
    );

    expect(markdown).toBe('first line\n\n障害対応メモ\n');
  });

  it('keeps RTF control characters as literal text', async () => {
    const markdown = await anydocMarkdown(buildRtf('a{b}c\\d'), 'rtf');

    expect(markdown).toContain('{b}c');
    expect(markdown).toMatch(/c\\{1,2}d/);
  });
});
