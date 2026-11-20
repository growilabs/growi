import type { Root } from 'mdast';
import type { Node } from 'unist';
import { visit } from 'unist-util-visit';

import { summarizeDrawioDiagram } from './drawio-diagram';

const EMBEDDED_IMAGE = '[embedded image]';
const EMBEDDED_DATA = '[embedded data]';
// URL schemes are case-insensitive, so `DATA:` is a data URI too. ')' ends
// the URI so a CSS `url(...)` keeps its closing parenthesis.
const HTML_DATA_URI = /\bdata:[^\s"'<>)]+/gi;
const DATA_URI = /^data:/i;
const DATA_IMAGE_URI = /^data:image\//i;
// Shared by every draw.io diagram on the page (see ai-summarize research.md 7.11).
const MAX_DRAWIO_INFLATED_BYTES = 10 * 1024 * 1024;

type Replacement = {
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

const standInFor = (url: string): string =>
  DATA_IMAGE_URI.test(url) ? EMBEDDED_IMAGE : EMBEDDED_DATA;

const offsetsOf = (node: Node): [number, number] | null => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start == null || end == null ? null : [start, end];
};

// An html node's `value` drops container prefixes such as `> `, so matches are
// located in the source slice to keep their offsets exact.
const replacementsInHtml = (
  body: string,
  [start, end]: [number, number],
): Replacement[] =>
  [...body.slice(start, end).matchAll(HTML_DATA_URI)].map((match) => ({
    start: start + match.index,
    end: start + match.index + match[0].length,
    text: standInFor(match[0]),
  }));

// Only the URL is replaced, so a link's text and a definition's label stay.
// The URL follows the text or label, so it is the last match in the node's
// source range, even when the text repeats it.
const replacementOfUrl = (
  body: string,
  [start, end]: [number, number],
  url: string,
): Replacement[] => {
  const index = body.lastIndexOf(url, end - url.length);
  return index < start
    ? []
    : [
        {
          start: index,
          end: index + url.length,
          text: standInFor(url),
        },
      ];
};

const collectReplacements = (body: string, tree: Root): Replacement[] => {
  const replacements: Replacement[] = [];
  let drawioRoom = MAX_DRAWIO_INFLATED_BYTES;
  visit(tree, (node) => {
    const offsets = offsetsOf(node);
    if (offsets == null) return;
    const [start, end] = offsets;
    if (node.type === 'code' && node.lang === 'drawio') {
      const { text, inflatedBytes } = summarizeDrawioDiagram(
        node.value,
        drawioRoom,
      );
      drawioRoom -= inflatedBytes;
      replacements.push({ start, end, text });
    } else if (node.type === 'image' && DATA_URI.test(node.url)) {
      replacements.push({ start, end, text: EMBEDDED_IMAGE });
    } else if (
      (node.type === 'link' || node.type === 'definition') &&
      DATA_URI.test(node.url)
    ) {
      replacements.push(...replacementOfUrl(body, offsets, node.url));
    } else if (node.type === 'html') {
      replacements.push(...replacementsInHtml(body, offsets));
    }
  });
  return replacements;
};

/**
 * Replaces embedded image data and draw.io diagrams with short stand-ins, in
 * the original source text so the rest of the Markdown is left untouched.
 * `tree` must be the result of parsing `body`.
 */
export const replaceEmbeddedContent = (body: string, tree: Root): string => {
  const replacements = collectReplacements(body, tree).sort(
    (a, b) => a.start - b.start,
  );
  if (replacements.length === 0) return body;

  const pieces: string[] = [];
  let cursor = 0;
  for (const { start, end, text } of replacements) {
    pieces.push(body.slice(cursor, start), text);
    cursor = end;
  }
  pieces.push(body.slice(cursor));
  return pieces.join('');
};
