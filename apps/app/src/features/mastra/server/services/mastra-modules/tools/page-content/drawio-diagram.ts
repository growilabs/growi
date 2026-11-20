import pako from 'pako';
import { SaxesParser, type SaxesTagPlain } from 'saxes';

import { cutText } from './cut-text';

// A shape with custom properties wraps its <mxCell> in <UserObject>/<object>
// and keeps its text in `label` instead of the cell's `value`.
const LABEL_ATTRIBUTE: ReadonlyMap<string, string> = new Map([
  ['mxCell', 'value'],
  ['UserObject', 'label'],
  ['object', 'label'],
]);
const MAX_TEXT_LENGTH = 2_000;
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/g;
// `[^<>]` keeps a run of '<' with no '>' linear to scan.
const HTML_TAG = /<[^<>]*>/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeHtmlEntities = (text: string): string =>
  text.replace(
    ENTITY,
    (match, hex: string | undefined, dec: string | undefined, name) => {
      if (name != null) return NAMED_ENTITIES[name] ?? match;
      const codePoint =
        hex != null ? Number.parseInt(hex, 16) : Number(dec ?? '');
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    },
  );

// Bytes still allowed to be inflated, shared by every diagram it is passed
// through. Counted as the bytes arrive, so a diagram that fails part way
// still uses up what it inflated.
type InflateBudget = { remaining: number };

const inflateRawWithin = (input: Uint8Array, budget: InflateBudget): Buffer => {
  const inflator = new pako.Inflate({ raw: true });
  const chunks: Uint8Array[] = [];
  // Throwing from onData stops pako before it inflates the next chunk.
  inflator.onData = (chunk: Uint8Array) => {
    budget.remaining -= chunk.length;
    if (budget.remaining < 0) {
      throw new Error('draw.io diagram is too large to inflate');
    }
    chunks.push(chunk);
  };
  inflator.push(input, true);
  if (inflator.err !== 0) {
    throw new Error(inflator.msg);
  }
  return Buffer.concat(chunks);
};

// Same decoding as validateCompressedData in packages/remark-drawio/src/utils/embed.ts.
const inflateDiagram = (base64: string, budget: InflateBudget): string =>
  decodeURIComponent(
    inflateRawWithin(Buffer.from(base64, 'base64'), budget).toString('utf8'),
  );

// The parser has already unescaped the XML; what is left is HTML.
const toPlainLabel = (attributeValue: string): string =>
  decodeHtmlEntities(attributeValue.replace(HTML_TAG, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const labelOf = (tag: SaxesTagPlain): string => {
  const attribute = LABEL_ATTRIBUTE.get(tag.name);
  const value = attribute == null ? undefined : tag.attributes[attribute];
  return value == null ? '' : toPlainLabel(value);
};

/**
 * Labels of one draw.io XML document, read in a single pass. A multi-page
 * <mxfile> holds one <diagram> per page, either as child elements or as
 * compressed text (see packages/remark-drawio/src/utils/mxfile.ts); compressed
 * pages are inflated and read in turn, one level deep.
 * Throws when the XML is not well-formed or holds no graph model.
 */
const collectLabels = (
  xml: string,
  budget: InflateBudget,
  readsPages: boolean,
): string[] => {
  const labels: string[] = [];
  let hasGraphModel = false;
  let pageText: string[] | null = null;

  const parser = new SaxesParser();
  parser.on('opentag', (tag) => {
    if (tag.name === 'mxGraphModel') {
      hasGraphModel = true;
    } else if (readsPages && tag.name === 'diagram') {
      pageText = [];
    }
    const label = labelOf(tag);
    if (label !== '') labels.push(label);
  });
  parser.on('text', (text) => {
    pageText?.push(text);
  });
  parser.on('closetag', (tag) => {
    if (pageText == null || tag.name !== 'diagram') return;
    const compressed = pageText.join('').trim();
    pageText = null;
    if (compressed === '') return;
    labels.push(
      ...collectLabels(inflateDiagram(compressed, budget), budget, false),
    );
    hasGraphModel = true;
  });
  parser.write(xml).close();

  if (!hasGraphModel) {
    throw new Error('not a draw.io graph model');
  }
  return labels;
};

const toStandIn = (labels: readonly string[]): string => {
  const text = [...new Set(labels)].join(' / ');
  if (text === '') return '[draw.io diagram]';
  return text.length > MAX_TEXT_LENGTH
    ? `[draw.io diagram: ${cutText(text, MAX_TEXT_LENGTH)}…]`
    : `[draw.io diagram: ${text}]`;
};

type DrawioDiagramSummary = {
  readonly text: string;
  readonly inflatedBytes: number;
};

/**
 * One-line stand-in for a ```drawio block: keeps only the text written on
 * the diagram, dropping coordinates and styling. Compressed diagrams inflate
 * at most `maxInflatedBytes`; past that the bare placeholder is returned.
 */
export const summarizeDrawioDiagram = (
  code: string,
  maxInflatedBytes: number,
): DrawioDiagramSummary => {
  const budget: InflateBudget = { remaining: maxInflatedBytes };
  const inflatedBytes = (): number =>
    Math.min(maxInflatedBytes, maxInflatedBytes - budget.remaining);
  const trimmed = code.trim();
  let labels: string[];
  try {
    // Base64 never starts with '<', so anything else is compressed.
    const xml = trimmed.startsWith('<')
      ? trimmed
      : inflateDiagram(trimmed, budget);
    labels = collectLabels(xml, budget, true);
  } catch {
    return { text: '[draw.io diagram]', inflatedBytes: inflatedBytes() };
  }
  return { text: toStandIn(labels), inflatedBytes: inflatedBytes() };
};
