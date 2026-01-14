import type { ElementContent } from 'hast';
import { h } from 'hastscript';
import type { Text } from 'mdast';
import type { LeafDirective, TextDirective } from 'mdast-util-directive';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

function echoDirective(node: TextDirective | LeafDirective): ElementContent[] {
  const mark = node.type === 'textDirective' ? ':' : '::';

  return [
    h('span', `${mark}${node.name}`),
    ...(node.children ?? []).map((child: Text) =>
      h('span', `[${child.value}]`),
    ),
  ];
}

export const remarkPlugin: Plugin = () => {
  return (tree) => {
    visit(tree, 'textDirective', (node: TextDirective) => {
      const tagName = 'span';

      if (node.data == null) {
        node.data = {};
      }
      const data = node.data;
      data.hName = tagName;
      data.hProperties = h(tagName, node.attributes ?? {}).properties;
      data.hChildren = echoDirective(node);
    });

    visit(tree, 'leafDirective', (node: LeafDirective) => {
      const tagName = 'div';

      if (node.data == null) {
        node.data = {};
      }
      const data = node.data;
      data.hName = tagName;
      data.hProperties = h(tagName, node.attributes ?? {}).properties;
      data.hChildren = echoDirective(node);
    });
  };
};
