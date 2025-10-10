import csvToMarkdownTable from 'csv-to-markdown-table';
import type { Code, Table } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';
import type { Plugin } from 'unified';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';

type Lang = 'csv' | 'csv-h' | 'tsv' | 'tsv-h';

function isXsv(lang?: string | null | undefined): lang is Lang {
  return /^(csv|csv-h|tsv|tsv-h)$/.test(lang as string);
}

function rewriteNode(node: Node, lang: Lang) {
  const tableContents = (node as Code).value;

  const tableDoc = csvToMarkdownTable(
    tableContents,
    lang === 'csv' || lang === 'csv-h' ? ',' : '\t',
    lang === 'csv-h' || lang === 'tsv-h',
  );
  const tableTree = fromMarkdown(tableDoc, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });

  // replace node
  if (tableTree.children[0] != null) {
    node.type = 'table';
    (node as Table).children = (tableTree.children[0] as Table).children;
  }
}

export const remarkPlugin: Plugin = () => (tree) => {
  visit(tree, 'code', (node: Code) => {
    if (isXsv(node.lang)) {
      rewriteNode(node, node.lang);
    }
  });
};
