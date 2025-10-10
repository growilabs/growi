import type { Properties } from 'hast';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Code, Node, Paragraph } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const SUPPORTED_ATTRIBUTES = ['diagramIndex', 'bol', 'eol', 'isDarkMode'];

interface Data {
  hName?: string;
  hProperties?: Properties;
}

type Lang = 'drawio';

function isDrawioBlock(lang?: string | null): lang is Lang {
  return /^drawio$/.test(lang ?? '');
}

function rewriteNode(node: Node, index: number, isDarkMode?: boolean) {
  node.type = 'paragraph';
  (node as Paragraph).children = [
    { type: 'text', value: (node as Code).value },
  ];

  if (node.data == null) {
    node.data = {};
  }
  const data: Data = node.data;
  data.hName = 'drawio';
  data.hProperties = {
    diagramIndex: index,
    bol: node.position?.start.line,
    eol: node.position?.end.line,
    isDarkMode: isDarkMode ? 'true' : 'false',
    key: `drawio-${index}`,
  };
}

type DrawioRemarkPlugin = {
  isDarkMode?: boolean;
};

export const remarkPlugin: Plugin<[DrawioRemarkPlugin]> = (options) => {
  return (tree) => {
    visit(tree, 'code', (node: Code, index) => {
      if (isDrawioBlock(node.lang)) {
        rewriteNode(node, index ?? 0, options.isDarkMode);
      }
    });
  };
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['drawio'],
  attributes: {
    drawio: SUPPORTED_ATTRIBUTES,
  },
};
