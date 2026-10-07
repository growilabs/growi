import type { Element } from 'hast';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Plugin } from 'unified';
import { CONTINUE, EXIT, visit } from 'unist-util-visit';

import { addClassToProperties } from './add-class';

const REGEXP_TARGET_TAGNAMES = new RegExp(
  /^(h1|h2|h3|h4|h5|h6|p|img|pre|blockquote|hr|ol|ul|table)$/,
);

export const rehypePlugin: Plugin = () => {
  return (tree) => {
    visit(tree, 'element', (node: Element) => {
      if (REGEXP_TARGET_TAGNAMES.test(node.tagName as string)) {
        const properties = node.properties ?? {};

        // skip footnotes node
        if (properties?.id === 'footnote-label') {
          return EXIT;
        }

        // add class
        addClassToProperties(properties, 'has-data-line');
        // add attribute
        properties['data-line'] = node.position?.start.line;

        node.properties = properties;
      }
      return CONTINUE;
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  attributes: {
    '*': ['data-line'],
  },
};
