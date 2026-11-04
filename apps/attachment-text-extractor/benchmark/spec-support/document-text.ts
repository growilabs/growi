import {
  anydocMarkdown,
  readZipEntries,
} from '../../test/fixtures/spec-support';
import type {
  BenchmarkEncoding,
  BenchmarkFormat,
  DocumentAnswer,
} from '../answers';

// Reads a corpus document's text per expected page without the generators'
// code: TextDecoder for text, cfb's ZIP reader plus the package relationships
// for OOXML, and anydoc for the binary formats it reads (XLS, DOC, PPT).

const DECODER_LABELS: Record<BenchmarkEncoding, string> = {
  'utf-8': 'utf-8',
  'utf-8-bom': 'utf-8',
  'utf-16le-bom': 'utf-16le',
  'utf-16be-bom': 'utf-16be',
  shift_jis: 'shift_jis',
  // WHATWG's shift_jis decoder is Windows-31J, i.e. cp932.
  cp932: 'shift_jis',
  'euc-jp': 'euc-jp',
  'iso-2022-jp': 'iso-2022-jp',
};

export const textDecoderLabel = (encoding: BenchmarkEncoding): string =>
  DECODER_LABELS[encoding];

/** Decodes strictly: invalid bytes throw. A leading BOM is dropped. */
export const decodeText = (
  bytes: Uint8Array,
  encoding: BenchmarkEncoding,
): string =>
  new TextDecoder(DECODER_LABELS[encoding], { fatal: true }).decode(bytes);

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

// Each text node on its own line, so a phrase only matches inside one node.
const xmlText = (xml: string): string =>
  xml
    .replace(/<[^>]*>/g, '\n')
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (_, name: string) => XML_ENTITIES[name],
    );

const entryText = (entries: Map<string, Buffer>, name: string): string => {
  const data = entries.get(name);
  if (data == null) {
    throw new Error(`no ZIP entry named ${name}`);
  }
  return data.toString('utf8');
};

const relationshipTargets = (relsXml: string): Map<string, string> =>
  new Map(
    [...relsXml.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [
      tag.match(/\bId="([^"]+)"/)?.[1] ?? '',
      tag.match(/\bTarget="([^"]+)"/)?.[1] ?? '',
    ]),
  );

/** Part names, in document order, of the parts a list element points at. */
const orderedParts = (
  entries: Map<string, Buffer>,
  directory: string,
  mainPart: string,
  itemTag: string,
): string[] => {
  const targets = relationshipTargets(
    entryText(entries, `${directory}/_rels/${mainPart}.rels`),
  );
  return [
    ...entryText(entries, `${directory}/${mainPart}`).matchAll(
      new RegExp(`<${itemTag}\\b[^>]*\\br:id="([^"]+)"`, 'g'),
    ),
  ].map(([, id]) => `${directory}/${targets.get(id)}`);
};

export const xlsxSheetNames = (xlsx: Uint8Array): string[] =>
  [
    ...entryText(readZipEntries(xlsx), 'xl/workbook.xml').matchAll(
      /<sheet\b[^>]*\bname="([^"]+)"/g,
    ),
  ].map(([, name]) => xmlText(name));

const ANYDOC_FORMATS: Partial<Record<BenchmarkFormat, string>> = {
  // anydoc reads legacy XLS under the xlsx format, as the service sends it.
  xls: 'xlsx',
  doc: 'doc',
  ppt: 'ppt',
};

const zipPageTexts = (bytes: Uint8Array, format: BenchmarkFormat): string[] => {
  const entries = readZipEntries(bytes);
  const texts = (parts: string[]) =>
    parts.map((part) => xmlText(entryText(entries, part)));
  switch (format) {
    case 'docx':
      return texts(['word/document.xml']);
    case 'xlsx':
      return texts(orderedParts(entries, 'xl', 'workbook.xml', 'sheet'));
    case 'pptx':
      return texts(orderedParts(entries, 'ppt', 'presentation.xml', 'p:sldId'));
    case 'odt':
    case 'ods':
    case 'odp':
      return texts(['content.xml']);
    default:
      throw new Error(`not a ZIP-based format: ${format}`);
  }
};

/** The document's text, one string per expected `pages[]` element. */
export const pageTexts = async (
  bytes: Uint8Array,
  answer: DocumentAnswer,
): Promise<string[]> => {
  const anydocFormat = ANYDOC_FORMATS[answer.format];
  if (anydocFormat != null) {
    return [await anydocMarkdown(bytes, anydocFormat)];
  }
  if (answer.encoding != null) {
    return [decodeText(bytes, answer.encoding)];
  }
  return zipPageTexts(bytes, answer.format);
};
