import type { Paragraph, Text } from 'mdast';
import type { ContainerDirective } from 'mdast-util-directive';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

import { AllCallout } from './consts';

export const remarkPlugin: Plugin = () => {
  return (tree) => {
    visit(tree, 'containerDirective', (node: ContainerDirective) => {
      if (AllCallout.some((name) => name === node.name.toLowerCase())) {
        const type = node.name.toLowerCase();
        if (node.data == null) {
          node.data = {};
        }
        const data = node.data;

        // extract directive label
        const paragraphs = (node.children ?? []).filter(
          (child): child is Paragraph => child.type === 'paragraph',
        );
        const paragraphForDirectiveLabel = paragraphs.find(
          (p) => p.data?.directiveLabel,
        );
        const label =
          paragraphForDirectiveLabel != null &&
          paragraphForDirectiveLabel.children.length > 0
            ? (paragraphForDirectiveLabel.children[0] as Text).value
            : undefined;
        // remove directive label from children
        if (paragraphForDirectiveLabel != null) {
          node.children.splice(
            node.children.indexOf(paragraphForDirectiveLabel),
            1,
          );
        }

        data.hName = 'callout';
        data.hProperties = {
          type,
          label,
        };
      }
    });
  };
};

export const sanitizeOption = {
  tagNames: ['callout'],
  attributes: {
    callout: ['type', 'label'],
  },
};
