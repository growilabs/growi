import type { Nodes as HastNode, Text } from 'hast';
import { select } from 'hast-util-select';
import parse from 'remark-parse';
import rehype from 'remark-rehype';
import { unified } from 'unified';

import { pukiwikiLikeLinker } from '../remark-plugins/pukiwiki-like-linker';
import { relativeLinksByPukiwikiLikeLinker } from './relative-links-by-pukiwiki-like-linker';

describe('relativeLinksByPukiwikiLikeLinker', () => {
  /* eslint-disable indent */
  describe.each`
    input                              | expectedHref                       | expectedValue
    ${'[[/page]]'}                     | ${'/page'}                         | ${'/page'}
    ${'[[./page]]'}                    | ${'/user/admin/page'}              | ${'./page'}
    ${'[[Title>./page]]'}              | ${'/user/admin/page'}              | ${'Title'}
    ${'[[Title>https://example.com]]'} | ${'https://example.com'}           | ${'Title'}
    ${'[[/page?q=foo#header]]'}        | ${'/page?q=foo#header'}            | ${'/page?q=foo#header'}
    ${'[[./page?q=foo#header]]'}       | ${'/user/admin/page?q=foo#header'} | ${'./page?q=foo#header'}
    ${'[[Title>./page?q=foo#header]]'} | ${'/user/admin/page?q=foo#header'} | ${'Title'}
    ${'[[Title>https://example.com]]'} | ${'https://example.com'}           | ${'Title'}
  `(
    'should convert relative links correctly',
    ({ input, expectedHref, expectedValue }) => {
      /* eslint-enable indent */

      test(`when the input is '${input}'`, () => {
        // setup:
        const processor = unified()
          .use(parse)
          .use(pukiwikiLikeLinker)
          .use(rehype)
          .use(relativeLinksByPukiwikiLikeLinker, { pagePath: '/user/admin' });

        // when:
        const mdast = processor.parse(input);
        const hast = processor.runSync(mdast) as HastNode;
        const anchorElement = select('a', hast);

        // then
        expect(anchorElement).not.toBeNull();
        expect(anchorElement?.properties).not.toBeNull();
        expect(
          (anchorElement?.properties?.className as string).startsWith(
            'pukiwiki-like-linker',
          ),
        ).toBeTruthy();
        expect(anchorElement?.properties?.href).toEqual(expectedHref);

        expect(anchorElement?.children[0]).not.toBeNull();
        expect(anchorElement?.children[0].type).toEqual('text');
        expect((anchorElement?.children[0] as HastNode as Text).value).toEqual(
          expectedValue,
        );
      });
    },
  );
});
