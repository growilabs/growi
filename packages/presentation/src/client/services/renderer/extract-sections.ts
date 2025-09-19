import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Plugin } from 'unified';
import type { Node, Parent } from 'unist';
import { findAfter } from 'unist-util-find-after';
import { visit } from 'unist-util-visit';

function wrapWithSection(
  parentNode: Parent,
  startElem: Node,
  endElem?: Node | null,
  isDarkMode?: boolean,
): void {
  const siblings = parentNode.children;

  const startIndex = siblings.indexOf(startElem);
  const endIndex = endElem != null ? siblings.indexOf(endElem) : undefined;

  const between = siblings.slice(startIndex, endIndex);

  const section = {
    type: 'section',
    children: between,
    data: {
      hName: 'section',
      hProperties: {
        className: isDarkMode ? 'invert' : '',
      },
    },
  };

  siblings.splice(startIndex, between.length, section);
}

function removeElement(parentNode: Parent, elem: Node): void {
  const siblings = parentNode.children;
  siblings.splice(siblings.indexOf(elem), 1);
}

export type ExtractSectionsPluginParams = {
  isDarkMode?: boolean;
  disableSeparationByHeader?: boolean;
};

export const remarkPlugin: Plugin<[ExtractSectionsPluginParams]> = (
  options,
) => {
  const { isDarkMode, disableSeparationByHeader } = options;

  const startCondition = (node: Node) => {
    if (!disableSeparationByHeader && node.type === 'heading') {
      return true;
    }
    return node.type !== 'thematicBreak';
  };
  const endCondition = (node: Node) => {
    if (!disableSeparationByHeader && node.type === 'heading') {
      return true;
    }
    return node.type === 'thematicBreak';
  };

  return (tree) => {
    // wrap with <section>
    visit(tree, startCondition, (node, _index, parent: Parent) => {
      if (parent == null || parent.type !== 'root' || node.type === 'yaml') {
        return;
      }

      const startElem = node;
      const endElem = findAfter(parent, startElem, endCondition);

      wrapWithSection(parent, startElem, endElem, isDarkMode);

      // remove <hr>
      if (endElem != null && endElem.type === 'thematicBreak') {
        removeElement(parent, endElem);
      }
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['section'],
};
