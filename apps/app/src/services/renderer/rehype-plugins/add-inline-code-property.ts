import type { Element, Root } from 'hast';
import type { Plugin } from 'unified';
import { is } from 'unist-util-is';
import { visitParents } from 'unist-util-visit-parents';

const isInlineCodeTag = (node: Element, parent: Element | Root | null): boolean => {
  if (node.tagName !== 'code') {
    return false;
  }

  if (parent && is(parent, { type: 'element', tagName: 'pre' })) {
    return false;
  }

  return true;
};

export const rehypePlugin: Plugin = () => {
  return (tree) => {
    visitParents(tree, 'element', (node: Element, ancestors) => {
      // The immediate parent is the last item in the ancestors array
      const parent = ancestors[ancestors.length - 1] || null;

      // Check if the current element is an inline <code> tag
      if (isInlineCodeTag(node, parent)) {
        node.properties = {
          ...node.properties,
          inline: true,
        };
      }
    });
  };
};
