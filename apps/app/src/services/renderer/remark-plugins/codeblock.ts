import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { InlineCode } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';


const SUPPORTED_CODE = ['inline'];

export const remarkPlugin: Plugin = () => {
  return (tree) => {
    visit(tree, 'inlineCode', (node: InlineCode) => {
      const data = node.data || (node.data = {});
      data.hProperties = { inline: true };
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['code'],
  attributes: {
    code: SUPPORTED_CODE,
  },
};
