import { decodeText } from './charset';
import { parseNotebookJson } from './notebook-json';

/** The cap on one cell output's text; convert() passes it, ConversionLimits does not carry it. */
export const IPYNB_OUTPUT_MAX_CHARS = 10_000;

type JsonObject = Readonly<Record<string, unknown>>;

const TEXT_MIME = 'text/plain';
// v4 keeps the text of these under "data"; v3 (pyout, stream) keeps "text".
const TEXT_OUTPUT_TYPES: ReadonlySet<unknown> = new Set([
  'stream',
  'pyout',
  'execute_result',
  'display_data',
]);

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const field = (object: JsonObject, key: string): unknown =>
  Object.hasOwn(object, key) ? object[key] : undefined;

// Per JSON string, as Python's json does: an escaped pair is one character, a
// lone surrogate (which UTF-8 cannot encode) becomes U+FFFD.
const wellFormed = (text: string): string =>
  text.isWellFormed() ? text : text.toWellFormed();

const asText = (value: unknown): string => {
  if (typeof value === 'string') {
    return wellFormed(value);
  }
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(wellFormed)
      .join('');
  }
  return '';
};

// Python slices by code points; a surrogate pair is one.
const firstCodePoints = (text: string, count: number): string => {
  if (text.length <= count) {
    return text;
  }
  let end = 0;
  for (let taken = 0; taken < count && end < text.length; taken += 1) {
    end += (text.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
  }
  return text.slice(0, end);
};

// A loop, not /\n+$/: that regex is quadratic on long inner runs of newlines.
const trimTrailingNewlines = (text: string): string => {
  let end = text.length;
  while (end > 0 && text[end - 1] === '\n') {
    end -= 1;
  }
  return text.slice(0, end);
};

const outputTexts = (output: unknown, cap: number): string[] => {
  if (!isObject(output)) {
    return [];
  }
  const bundle = field(output, 'data');
  const texts = [
    isObject(bundle) ? asText(field(bundle, TEXT_MIME)) : '',
    TEXT_OUTPUT_TYPES.has(field(output, 'output_type'))
      ? asText(field(output, 'text'))
      : '',
  ];
  return texts
    .filter((text) => text !== '')
    .map((text) => firstCodePoints(text, cap));
};

const cellTexts = (cell: unknown, cap: number): string[] => {
  if (!isObject(cell)) {
    return [];
  }
  const outputs = field(cell, 'outputs');
  const texts = [
    asText(field(cell, 'source')) || asText(field(cell, 'input')),
    ...(Array.isArray(outputs)
      ? outputs.flatMap((output) => outputTexts(output, cap))
      : []),
  ];
  return texts.filter((text) => text !== '').map(trimTrailingNewlines);
};

const notebookCells = (notebook: unknown): readonly unknown[] | null => {
  if (!isObject(notebook)) {
    return null;
  }
  const cells = field(notebook, 'cells');
  if (Array.isArray(cells)) {
    return cells;
  }
  const worksheets = field(notebook, 'worksheets');
  if (!Array.isArray(worksheets)) {
    return null;
  }
  return worksheets.flatMap((sheet) => {
    const sheetCells = isObject(sheet) ? field(sheet, 'cells') : undefined;
    return Array.isArray(sheetCells) ? sheetCells : [];
  });
};

/** Cell sources and text outputs of a notebook; the decoded text itself when it is not one. */
export const ipynbToText = (
  bytes: Uint8Array,
  outputMaxChars: number,
): string => {
  const text = decodeText(bytes);
  const cells = notebookCells(parseNotebookJson(text));
  if (cells === null) {
    return text;
  }
  return cells.flatMap((cell) => cellTexts(cell, outputMaxChars)).join('\n');
};
