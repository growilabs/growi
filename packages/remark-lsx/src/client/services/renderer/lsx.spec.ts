import type { LeafGrowiPluginDirective } from '@growi/remark-growi-directive';
import { remarkGrowiDirectivePluginType } from '@growi/remark-growi-directive';

import { remarkPlugin } from './lsx';

const createNode = (
  attributes: Record<string, string>,
): LeafGrowiPluginDirective => ({
  type: remarkGrowiDirectivePluginType.Leaf,
  name: 'lsx',
  attributes,
  children: [],
});

const runPlugin = (node: LeafGrowiPluginDirective) => {
  const tree = { type: 'root', children: [node] };
  (remarkPlugin as () => (tree: unknown) => void)()(tree);
};

describe('remarkPlugin', () => {
  describe('prefix extraction', () => {
    describe('explicit prefix attribute takes priority', () => {
      it.concurrent.each`
        scenario                                  | attributes                        | expectedPrefix
        ${'explicit prefix attribute'}            | ${{ prefix: '/path' }}            | ${'/path'}
        ${'explicit prefix over bare'}            | ${{ '/foo': '', prefix: '/bar' }} | ${'/bar'}
        ${'explicit empty string prefix is used'} | ${{ prefix: '', '/path': '' }}    | ${''}
      `('should handle $scenario', ({ attributes, expectedPrefix }) => {
        const node = createNode(attributes);
        runPlugin(node);
        expect(node.data?.hProperties).toMatchObject({
          prefix: expectedPrefix,
        });
      });
    });

    describe('bare attribute as prefix', () => {
      it.concurrent.each`
        scenario                        | attributes                 | expectedPrefix
        ${'single bare attribute'}      | ${{ '/path': '' }}         | ${'/path'}
        ${'multi-word bare attributes'} | ${{ '/foo': '', bar: '' }} | ${'/foo bar'}
      `(
        'should extract prefix from $scenario',
        ({ attributes, expectedPrefix }) => {
          const node = createNode(attributes);
          runPlugin(node);
          expect(node.data?.hProperties).toMatchObject({
            prefix: expectedPrefix,
          });
        },
      );
    });

    describe('bare attribute joining stops at boundaries', () => {
      it.concurrent.each`
        scenario                                          | attributes                                | expectedPrefix
        ${'non-empty value stops joining'}                | ${{ '/foo': '', bar: 'baz' }}             | ${'/foo'}
        ${'supported attribute stops joining'}            | ${{ '/foo': '', '/bar': '', depth: '1' }} | ${'/foo /bar'}
        ${'supported attribute with empty value stops'}   | ${{ '/foo': '', depth: '' }}              | ${'/foo'}
        ${'both conditions true (non-empty + supported)'} | ${{ '/foo': '', depth: '1' }}             | ${'/foo'}
      `('should handle $scenario', ({ attributes, expectedPrefix }) => {
        const node = createNode(attributes);
        runPlugin(node);
        expect(node.data?.hProperties).toMatchObject({
          prefix: expectedPrefix,
        });
      });
    });

    describe('no prefix set when conditions not met', () => {
      it.concurrent.each`
        scenario                                  | attributes
        ${'empty attributes'}                     | ${{}}
        ${'first attribute is supported attr'}    | ${{ depth: '1', '/path': '' }}
        ${'first attribute is non-empty'}         | ${{ '/path': 'value' }}
        ${'only supported attributes present'}    | ${{ depth: '1', sort: 'asc' }}
        ${'supported attr with empty value only'} | ${{ depth: '' }}
      `('should not set prefix when $scenario', ({ attributes }) => {
        const node = createNode(attributes);
        runPlugin(node);
        expect(node.data?.hProperties?.prefix).toBeUndefined();
      });
    });
  });
});
