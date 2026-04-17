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
    it('case 1: should use explicit prefix attribute', () => {
      // $lsx(prefix=/path)
      const node = createNode({ prefix: '/path' });
      runPlugin(node);
      expect(node.data?.hProperties).toMatchObject({ prefix: '/path' });
    });

    it('case 2: should use first bare attribute as prefix', () => {
      // $lsx(/path)
      const node = createNode({ '/path': '' });
      runPlugin(node);
      expect(node.data?.hProperties).toMatchObject({ prefix: '/path' });
    });

    it('case 3: should prefer explicit prefix over bare attribute', () => {
      // $lsx(/foo, prefix=/bar)
      const node = createNode({ '/foo': '', prefix: '/bar' });
      runPlugin(node);
      expect(node.data?.hProperties).toMatchObject({ prefix: '/bar' });
    });

    it('case 4: should join consecutive bare attributes as prefix when path contains spaces', () => {
      // $lsx(/foo bar) - micromark parser splits "/foo bar" into "/foo" and "bar"
      const node = createNode({ '/foo': '', bar: '' });
      runPlugin(node);
      expect(node.data?.hProperties).toMatchObject({ prefix: '/foo bar' });
    });
  });
});
