import type { Nodes as HastNode } from 'hast';
import { select } from 'hast-util-select';
import parse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

import { relativeLinks } from './relative-links';

describe('relativeLinks', () => {
  test('do nothing when the options does not have pagePath', () => {
    // setup
    const processor = unified()
      .use(parse)
      .use(remarkRehype)
      .use(relativeLinks, {});

    // when
    const mdastTree = processor.parse('[link](/Sandbox)');
    const hastTree = processor.runSync(mdastTree) as HastNode;

    // then
    const anchorElement = select('a', hastTree);
    expect(anchorElement?.properties?.href).toBe('/Sandbox');
  });

  test.concurrent.each`
    originalHref
    ${'http://example.com/Sandbox'}
    ${'#header'}
  `("leaves the original href '$originalHref' as-is", ({ originalHref }) => {
    // setup
    const pagePath = '/foo/bar/baz';
    const processor = unified()
      .use(parse)
      .use(remarkRehype)
      .use(relativeLinks, { pagePath });

    // when
    const mdastTree = processor.parse(`[link](${originalHref})`);
    const hastTree = processor.runSync(mdastTree) as HastNode;

    // then
    const anchorElement = select('a', hastTree);
    expect(anchorElement?.properties?.href).toBe(originalHref);
  });

  test.concurrent.each`
    originalHref                | expectedHref
    ${'/Sandbox'}               | ${'/Sandbox'}
    ${'/Sandbox?q=foo'}         | ${'/Sandbox?q=foo'}
    ${'/Sandbox#header'}        | ${'/Sandbox#header'}
    ${'/Sandbox?q=foo#header'}  | ${'/Sandbox?q=foo#header'}
    ${'./Sandbox'}              | ${'/foo/bar/Sandbox'}
    ${'./Sandbox?q=foo'}        | ${'/foo/bar/Sandbox?q=foo'}
    ${'./Sandbox#header'}       | ${'/foo/bar/Sandbox#header'}
    ${'./Sandbox?q=foo#header'} | ${'/foo/bar/Sandbox?q=foo#header'}
  `(
    "rewrites the original href '$originalHref' to '$expectedHref'",
    ({ originalHref, expectedHref }) => {
      // setup
      const pagePath = '/foo/bar/baz';
      const processor = unified()
        .use(parse)
        .use(remarkRehype)
        .use(relativeLinks, { pagePath });

      // when
      const mdastTree = processor.parse(`[link](${originalHref})`);
      const hastTree = processor.runSync(mdastTree) as HastNode;

      // then
      const anchorElement = select('a', hastTree);
      expect(anchorElement).not.toBeNull();
      expect(anchorElement?.properties).not.toBeNull();
      expect(anchorElement?.properties?.href).toBe(expectedHref);
    },
  );
});
