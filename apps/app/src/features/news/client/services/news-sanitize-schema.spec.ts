import type { Element, Nodes } from 'hast';
import { sanitize } from 'hast-util-sanitize';
import { h } from 'hastscript';

import { newsSanitizeSchema } from './news-sanitize-schema';

// rehype-sanitize is a thin wrapper over hast-util-sanitize's sanitize(), so
// applying the schema this way exercises the exact transformation the news
// pipeline performs. Testing the schema directly (not only through a full
// react-markdown render) closes the gap the pipeline tests could not see: with
// raw HTML unparsed and bad images pre-removed, deleting sanitize from the
// options left every component test green — the security core was never fixed
// by a test.
const clean = (tree: Nodes): Nodes => sanitize(tree, newsSanitizeSchema);

const collectTagNames = (node: Nodes): string[] => {
  const names: string[] = [];
  const walk = (n: Nodes): void => {
    if (n.type === 'element') names.push(n.tagName);
    if ('children' in n) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return names;
};

const collectText = (node: Nodes): string => {
  let text = '';
  const walk = (n: Nodes): void => {
    if (n.type === 'text') text += n.value;
    if ('children' in n) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return text;
};

const firstElement = (node: Nodes, tagName: string): Element | undefined => {
  let found: Element | undefined;
  const walk = (n: Nodes): void => {
    if (found != null) return;
    if (n.type === 'element' && n.tagName === tagName) {
      found = n;
      return;
    }
    if ('children' in n) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return found;
};

describe('newsSanitizeSchema', () => {
  test('keeps allowed formatting, tables, headings, links, and https images', () => {
    const tree = h(null, [
      h('h1', 'Title'),
      h('p', [h('strong', 'b'), h('em', 'i'), h('del', 'd'), h('code', 'c')]),
      h('ul', [h('li', 'x')]),
      h('table', [
        h('thead', [h('tr', [h('th', 'H')])]),
        h('tbody', [h('tr', [h('td', 'C')])]),
      ]),
      h('a', { href: 'https://example.com', title: 't' }, 'link'),
      h('img', { src: 'https://cdn.example.com/x.png', alt: 'a' }),
    ]);

    const names = collectTagNames(clean(tree));

    for (const tag of [
      'h1',
      'p',
      'strong',
      'em',
      'del',
      'code',
      'ul',
      'li',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'a',
      'img',
    ]) {
      expect(names).toContain(tag);
    }
  });

  // The behavior that #3 fixed: a disallowed element is dropped together with
  // its children, NOT unwrapped to its (allowed) descendants. With a `strip`
  // list set, hast-util-sanitize would keep the <h2>/<ol> of a GFM footnote
  // section; with no strip it removes them.
  test('drops a disallowed element together with its children (no unwrap)', () => {
    const tree = h(null, [
      h('section', { className: ['footnotes'] }, [
        h('h2', 'Footnotes'),
        h('ol', [h('li', 'a footnote')]),
      ]),
    ]);

    const out = clean(tree);
    const names = collectTagNames(out);

    expect(names).not.toContain('section');
    expect(names).not.toContain('h2');
    expect(names).not.toContain('ol');
    expect(collectText(out)).not.toContain('Footnotes');
    expect(collectText(out)).not.toContain('a footnote');
  });

  test('removes disallowed elements (iframe/video/script/style/input)', () => {
    const tree = h(null, [
      h('iframe', { src: 'https://evil.example.com' }),
      h('video', [h('source', { src: 'https://evil.example.com/v.mp4' })]),
      h('script', 'alert(1)'),
      h('style', '* { color: red }'),
      h('input', { type: 'checkbox' }),
    ]);

    const names = collectTagNames(clean(tree));

    for (const tag of [
      'iframe',
      'video',
      'source',
      'script',
      'style',
      'input',
    ]) {
      expect(names).not.toContain(tag);
    }
  });

  test('strips event handlers and non-allowed attributes from a kept element', () => {
    const tree = h(null, [
      h(
        'a',
        {
          href: 'https://x.example',
          onClick: 'evil()',
          style: 'color:red',
          className: ['c'],
          id: 'i',
        },
        'l',
      ),
    ]);

    const a = firstElement(clean(tree), 'a');

    expect(a?.properties.href).toBe('https://x.example');
    expect(Object.keys(a?.properties ?? {}).some((k) => /^on/i.test(k))).toBe(
      false,
    );
    expect(a?.properties.style).toBeUndefined();
    expect(a?.properties.className).toBeUndefined();
    expect(a?.properties.id).toBeUndefined();
  });

  test('neutralizes a javascript: href and a non-https image src', () => {
    const tree = h(null, [
      h('a', { href: 'javascript:alert(1)' }, 'x'),
      h('img', { src: 'http://cdn.example.com/x.png', alt: 'a' }),
    ]);

    const out = clean(tree);

    // The <a> stays but its javascript: href is removed.
    expect(firstElement(out, 'a')?.properties.href).toBeUndefined();
    // The <img> stays but its http (non-https) src is removed.
    expect(firstElement(out, 'img')?.properties.src).toBeUndefined();
  });
});
