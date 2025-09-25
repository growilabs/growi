import type { Properties } from 'hast';
import type { Schema as SanitizeOption } from 'hast-util-sanitize';
import type { Code, Node, Paragraph } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const SUPPORTED_ATTRIBUTES = ['diagramIndex', 'bol', 'eol'];

interface Data {
  hName?: string;
  hProperties?: Properties;
}

type Lang = 'drawio';

function isDrawioBlock(lang?: string | null): lang is Lang {
  return /^drawio$/.test(lang ?? '');
}

function rewriteNode(node: Node, index: number) {
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
    key: `drawio-${index}`,
  };
}

export const remarkPlugin: Plugin = () => (tree) => {
  visit(tree, 'code', (node: Code, index) => {
    if (isDrawioBlock(node.lang)) {
      rewriteNode(node, index ?? 0);
    }
  });
};

export const sanitizeOption: SanitizeOption = {
  tagNames: ['drawio'],
  attributes: {
    drawio: SUPPORTED_ATTRIBUTES,
  },
};
