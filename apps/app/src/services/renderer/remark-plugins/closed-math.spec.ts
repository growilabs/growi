import katex from 'rehype-katex';
import stringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import math from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { closedMath } from './closed-math';

const render = (source: string, preview = true) => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(math);
  if (preview) processor.use(closedMath);
  return String(
    processor.use(remarkRehype).use(katex).use(stringify).processSync(source),
  );
};

describe('closedMath', () => {
  it('keeps paragraphs and headings readable after an unfinished math fence', () => {
    const html = render('Before\n\n$$\nSome prose }\n\n## After\n\nMore text');
    expect(html).not.toContain('katex-error');
    expect(html).toContain('<h2>After</h2>');
    expect(html).toContain('<p>More text</p>');
    expect(html).toContain('$$');
  });

  it.each([
    '$$\nx^2\n$$',
    '$$$\nx^2\n$$$',
    '$$ equation\nx^2\n$$',
    '> $$\n> x^2\n> $$',
    '- $$\n  x^2\n  $$',
    '$$\nx^2\n$$$$',
  ])('preserves complete math: %s', (source) => {
    expect(render(source)).toBe(render(source, false));
    expect(render(source)).toContain('katex');
  });

  it.each([
    '$$',
    '$$\nx^2',
    '$$$\nx^2\n$$',
    '> $$\n> prose }\n>\n> ## Heading',
    '- $$\n  prose }\n\n  ## Heading',
    '$$\r\nprose }\r\n\r\n## Heading',
  ])('does not render unfinished math as an error: %s', (source) => {
    expect(render(source)).not.toContain('katex-error');
    expect(render(source)).not.toContain('class="katex');
  });

  it('keeps inline math and fenced code unchanged', () => {
    const source = 'Inline $x^2$ and $$y^2$$\n\n```text\n$$\nprose }\n```';
    expect(render(source)).toBe(render(source, false));
  });

  it('preserves escaped delimiters and dollars in code spans', () => {
    const source = 'Escaped \\$\\$ and inline code `$$`\n\n# After';
    expect(render(source)).toBe(render(source, false));
  });

  it('retains GFM tables after an unfinished fence', () => {
    const html = render('$$\nprose }\n\n| A | B |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).not.toContain('katex-error');
  });

  it('does not disable complete math before an unfinished block', () => {
    const html = render('$$\nx^2\n$$\n\n$$\nprose }\n\n# After');
    expect(html).toContain('class="katex');
    expect(html).not.toContain('katex-error');
    expect(html).toContain('<h1>After</h1>');
  });

  it('renders the math as soon as its closing fence is entered', () => {
    expect(render('$$\nx^2')).not.toContain('class="katex');
    expect(render('$$\nx^2\n$$')).toContain('class="katex');
  });

  it('does not change the standard renderer through shared tokenizer objects', () => {
    render('$$\nprose }');
    expect(render('$$\nprose }', false)).toContain('katex-error');
  });

  it('preserves source line positions for preview annotations', () => {
    const processor = unified().use(remarkParse).use(math).use(closedMath);
    const tree = processor.parse('Before\n\n$$\nprose }\n\n## After');
    expect(tree.children.at(-1)).toMatchObject({
      type: 'heading',
      position: { start: { line: 6, column: 1, offset: 20 } },
    });
  });
});
