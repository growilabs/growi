import { buildDocx, docxParts } from './docx';
import { anydocMarkdown, readZipText } from './spec-support';
import { buildZip } from './zip';

describe('buildDocx', () => {
  it('writes a DOCX whose paragraphs anydoc extracts', async () => {
    const docx = buildDocx([
      '障害対応メモ 本番環境で発生した情報システムの障害',
      'second paragraph',
    ]);

    const markdown = await anydocMarkdown(docx, 'docx');

    expect(markdown).toContain(
      '障害対応メモ 本番環境で発生した情報システムの障害',
    );
    expect(markdown).toContain('second paragraph');
  });

  it('writes a newline inside a paragraph as a line break, as python-docx does', async () => {
    const docx = buildDocx(['情報シス\nテム']);

    expect(readZipText(docx, 'word/document.xml')).toContain(
      '<w:t>情報シス</w:t><w:br/><w:t>テム</w:t>',
    );
    // python-docx's document converts to this same Markdown hard break.
    expect(await anydocMarkdown(docx, 'docx')).toBe('情報シス\\\nテム\n');
  });

  it('keeps XML special characters as text', async () => {
    const docx = buildDocx(['a < b & "c" > d']);

    expect(await anydocMarkdown(docx, 'docx')).toContain('b &');
  });
});

describe('docxParts', () => {
  it('lets a caller swap one part and still get a readable DOCX', async () => {
    const replacement = docxParts(['replacement text']).find(
      (part) => part.name === 'word/document.xml',
    );
    if (replacement == null) {
      throw new Error('docxParts has no word/document.xml');
    }

    const parts = docxParts(['original text']).map((part) =>
      part.name === replacement.name ? replacement : part,
    );
    const markdown = await anydocMarkdown(buildZip(parts), 'docx');

    expect(markdown).toContain('replacement text');
    expect(markdown).not.toContain('original text');
  });
});
