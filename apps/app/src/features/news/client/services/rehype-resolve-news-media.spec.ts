import type { Element, Root } from 'hast';

import { rehypeResolveNewsMedia } from './rehype-resolve-news-media';

const img = (src: string): Element => ({
  type: 'element',
  tagName: 'img',
  properties: { src },
  children: [],
});

const p = (text: string): Element => ({
  type: 'element',
  tagName: 'p',
  properties: {},
  children: [{ type: 'text', value: text }],
});

const run = (children: Root['children']): Root => {
  const tree: Root = { type: 'root', children };
  rehypeResolveNewsMedia()(tree);
  return tree;
};

const FEED_IMAGE = 'https://growilabs.github.io/growi-news-feed/images/x.png';

describe('rehypeResolveNewsMedia', () => {
  test('rewrites a valid relative img src to the absolute feed URL', () => {
    const tree = run([img('images/x.png')]);
    const node = tree.children[0] as Element;
    expect(node.tagName).toBe('img');
    expect(node.properties.src).toBe(FEED_IMAGE);
  });

  test('removes an img whose src fails validation, keeping siblings', () => {
    const tree = run([p('before'), img('images/../escape.png'), p('after')]);
    const tags = tree.children.map((n) => (n as Element).tagName);
    expect(tags).toEqual(['p', 'p']);
  });

  test('removes an img with an off-origin src', () => {
    const tree = run([img('https://evil.example.com/images/x.png')]);
    expect(tree.children).toHaveLength(0);
  });

  test('removes consecutive invalid imgs (no skipped node)', () => {
    const tree = run([
      img('images/../a.png'),
      img('images/../b.png'),
      p('kept'),
    ]);
    const tags = tree.children.map((n) => (n as Element).tagName);
    expect(tags).toEqual(['p']);
  });

  test('leaves a non-img element untouched', () => {
    const tree = run([p('text')]);
    expect(tree.children).toHaveLength(1);
    expect((tree.children[0] as Element).tagName).toBe('p');
  });
});
