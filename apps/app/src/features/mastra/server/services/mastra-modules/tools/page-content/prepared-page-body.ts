import type { Heading, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';
import { visit } from 'unist-util-visit';

import { replaceEmbeddedContent } from './replace-embedded-content';

export type OutlineEntry = {
  readonly line: number;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly heading: string;
};

/**
 * A page body as the agent sees it: embedded content already replaced, line
 * endings normalised to LF, and the outline and line offsets computed once.
 * Outline line numbers and slice offsets both refer to this `body`.
 */
export type PreparedPageBody = {
  readonly body: string;
  readonly outline: readonly OutlineEntry[];
  // Index i holds the offset where line i + 1 starts.
  readonly lineStarts: readonly number[];
};

// Code blocks and HTML blocks are excluded by the parser.
const extractOutline = (tree: Root): OutlineEntry[] => {
  const entries: OutlineEntry[] = [];
  visit(tree, 'heading', (node: Heading) => {
    if (node.position == null) return;
    entries.push({
      line: node.position.start.line,
      level: node.depth,
      heading: mdastToString(node),
    });
  });
  return entries;
};

const findLineStarts = (text: string): number[] => {
  const starts = [0];
  let nl = text.indexOf('\n');
  while (nl !== -1) {
    starts.push(nl + 1);
    nl = text.indexOf('\n', nl + 1);
  }
  return starts;
};

export const preparePageBody = (rawBody: string): PreparedPageBody => {
  const rawTree = fromMarkdown(rawBody);
  const replaced = replaceEmbeddedContent(rawBody, rawTree);
  // A bare CR is not a line break here, so only CRLF is normalised.
  const body = replaced.replace(/\r\n/g, '\n');
  // Replacing changes line numbers, so the outline comes from the result.
  const tree = replaced === rawBody ? rawTree : fromMarkdown(body);
  return {
    body,
    outline: extractOutline(tree),
    lineStarts: findLineStarts(body),
  };
};

export const countLines = (prepared: PreparedPageBody): number =>
  prepared.lineStarts.length;

/**
 * The `count` lines starting at 1-indexed line `from`. A range starting past
 * the last line is empty, not an error.
 */
export const sliceLines = (
  prepared: PreparedPageBody,
  from: number,
  count: number,
): { slice: string; hasMore: boolean } => {
  const { body, lineStarts } = prepared;
  const totalLines = lineStarts.length;
  if (from > totalLines) {
    return { slice: '', hasMore: false };
  }
  const nextLineIndex = from - 1 + count;
  const end =
    nextLineIndex < totalLines ? lineStarts[nextLineIndex] - 1 : body.length;
  return {
    slice: body.substring(lineStarts[from - 1], end),
    hasMore: nextLineIndex < totalLines,
  };
};
