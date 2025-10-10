import parse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import { pukiwikiLikeLinker } from './pukiwiki-like-linker';

describe('pukiwikiLikeLinker', () => {
  describe.each`
    input                              | expectedHref             | expectedValue
    ${'[[/page]]'}                     | ${'/page'}               | ${'/page'}
    ${'[[./page]]'}                    | ${'./page'}              | ${'./page'}
    ${'[[Title>./page]]'}              | ${'./page'}              | ${'Title'}
    ${'[[Title>https://example.com]]'} | ${'https://example.com'} | ${'Title'}
    ${'[[/page?q=foo#header]]'}        | ${'/page?q=foo#header'}  | ${'/page?q=foo#header'}
    ${'[[./page?q=foo#header]]'}       | ${'./page?q=foo#header'} | ${'./page?q=foo#header'}
    ${'[[Title>./page?q=foo#header]]'} | ${'./page?q=foo#header'} | ${'Title'}
    ${'[[Title>https://example.com]]'} | ${'https://example.com'} | ${'Title'}
  `('should parse correctly', ({ input, expectedHref, expectedValue }) => {
    test(`when the input is '${input}'`, () => {
      // setup:
      const processor = unified().use(parse).use(pukiwikiLikeLinker);

      // when:
      const ast = processor.parse(input);

      expect(ast).not.toBeNull();

      visit(ast, 'wikiLink', (node: any) => {
        expect(node.data.alias).toEqual(expectedValue);
        expect(node.data.permalink).toEqual(expectedHref);
        expect(node.data.hName).toEqual('a');
        expect(
          node.data.hProperties.className.startsWith('pukiwiki-like-linker'),
        ).toBeTruthy();
        expect(node.data.hProperties.href).toEqual(expectedHref);
        expect(node.data.hChildren[0].value).toEqual(expectedValue);
      });
    });
  });
});
