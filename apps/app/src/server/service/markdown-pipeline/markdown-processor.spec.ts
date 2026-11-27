import type { Element, Root } from 'hast';

import { renderMarkdownToHtml, renderMarkdownToTextHast } from '.';

const elementsOf = (tree: Root): Element[] => {
  const found: Element[] = [];
  const walk = (node: Root | Element): void => {
    for (const child of node.children) {
      if (child.type === 'element') {
        found.push(child);
        walk(child);
      }
    }
  };
  walk(tree);
  return found;
};

const hasClass = (element: Element, className: string): boolean => {
  const value = element.properties.className;
  return Array.isArray(value)
    ? value.includes(className)
    : typeof value === 'string' && value.split(/\s+/).includes(className);
};

describe('renderMarkdownToHtml (bulk-export output)', () => {
  it('renders math with KaTeX', async () => {
    expect(await renderMarkdownToHtml('a $x^2$ b')).toContain('katex');
  });

  it('leaves [[page]] links and $name directives as written', async () => {
    const html = await renderMarkdownToHtml('see [[Foo]] and $lsx() here');
    expect(html).toContain('[[Foo]]');
    expect(html).toContain('$lsx()');
  });
});

describe('renderMarkdownToTextHast (inline comment anchor text)', () => {
  it('does not run KaTeX', async () => {
    const tree = await renderMarkdownToTextHast('a $x^2$ b\n\n$$\nE=mc^2\n$$');
    expect(elementsOf(tree).some((el) => hasClass(el, 'katex'))).toBe(false);
  });

  it('interprets [[page]] links and $name directives as the browser does', async () => {
    const tree = await renderMarkdownToTextHast('see [[Foo]] here');
    const link = elementsOf(tree).find((el) => el.tagName === 'a');
    expect(link?.children).toEqual([
      expect.objectContaining({ type: 'text', value: 'Foo' }),
    ]);
  });
});
