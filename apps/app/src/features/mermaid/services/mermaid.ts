import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Code } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

function rewriteNode(node: Code) {
  // replace node
  if (node.data == null) {
    node.data = {};
  }
  const data = node.data;
  data.hName = 'mermaid';
  data.hProperties = {
    value: node.value,
  };
}

export const remarkPlugin: Plugin = () => (tree) => {
  visit(tree, 'code', (node: Code) => {
    if (node.lang === 'mermaid') {
      rewriteNode(node);
    }
  });
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['mermaid'],
  attributes: {
    mermaid: ['value'],
  },
};
