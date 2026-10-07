import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { InlineCode } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const SUPPORTED_CODE = ['inline'];

export const remarkPlugin: Plugin = () => {
  return (tree) => {
    visit(tree, 'inlineCode', (node: InlineCode) => {
      if (node.data == null) {
        node.data = {};
      }
      const data = node.data;
      data.hProperties = { inline: 'true' }; // set 'true' explicitly because the empty string is evaluated as false for `if (inline) { ... }`
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['code'],
  attributes: {
    code: SUPPORTED_CODE,
  },
};
