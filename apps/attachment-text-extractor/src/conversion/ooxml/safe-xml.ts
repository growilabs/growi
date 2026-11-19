import { DOMParser, type Document, XMLSerializer } from '@xmldom/xmldom';

import { ConversionError } from '../conversion-error';
import { hasNamespaceError } from './dom-elements';
import { type SpanKind, stripSpans } from './strip-spans';
import { decodeXmlPart } from './xml-bytes';
import {
  hasTooManyNamespaceDeclarations,
  isRefusedByExpat,
} from './xml-prechecks';

const UTF8_DECLARATION = "<?xml version='1.0' encoding='UTF-8'?>";
const LEADING_DECLARATION = /^<\?xml[^>]*\?>\s*/;
// Comments, processing instructions and quoted literals of the internal
// subset may mention '<!ENTITY' without declaring anything.
const SUBSET_VERBATIM: readonly SpanKind[] = [
  ['<!--', '-->'],
  ['<?', '?>'],
  ['"', '"'],
  ["'", "'"],
];
const ENTITY_DECLARATION = /<!ENTITY/i;
// XML 1.0 line ends only; xmldom's default also folds U+0085 / U+2028 (XML 1.1).
const XML10_LINE_END = /\r\n?/g;

class NotWellFormed extends Error {}

const parseStrictly = (text: string): Document =>
  new DOMParser({
    onError: (level) => {
      throw new NotWellFormed(level);
    },
    normalizeLineEndings: (source) => source.replace(XML10_LINE_END, '\n'),
  }).parseFromString(text, 'text/xml');

const declaresEntities = (document: Document): boolean =>
  document.doctype != null &&
  ENTITY_DECLARATION.test(
    stripSpans(document.doctype.internalSubset ?? '', SUBSET_VERBATIM),
  );

const isUsable = (document: Document): boolean =>
  document.documentElement != null &&
  !declaresEntities(document) &&
  !hasNamespaceError(document.documentElement);

const parseText = (text: string): Document | null => {
  try {
    const document = parseStrictly(text);
    return isUsable(document) ? document : null;
  } catch (error) {
    // xmldom reports a refusal by rethrowing what onError threw, wrapped.
    if (error instanceof Error) {
      return null;
    }
    throw error;
  }
};

/**
 * Parses one OOXML part without expanding entities or reading anything
 * outside the bytes, refusing what defusedxml / expat refuse (research.md
 * 18.5.4, with the differences of 18.7 item 9). The DOCTYPE is dropped.
 */
export const parseXmlPart = (bytes: Uint8Array, label: string): Document => {
  const malformed = (): ConversionError =>
    new ConversionError('malformed', `${label} is not well-formed XML`);
  const text = decodeXmlPart(bytes);
  if (text == null || isRefusedByExpat(text)) {
    throw malformed();
  }
  // A limit, not malformed XML: the Python service fails the same files on
  // anydoc's XML depth limit.
  if (hasTooManyNamespaceDeclarations(text)) {
    throw new ConversionError(
      'limit_exceeded',
      `${label} declares too many namespaces`,
    );
  }
  const document = parseText(text);
  if (document == null) {
    throw malformed();
  }
  // Removed once, here: xmldom keeps doc.doctype pointing at the removed node,
  // so a second removal throws.
  if (document.doctype != null) {
    document.removeChild(document.doctype);
  }
  return document;
};

/** UTF-8 with a fresh declaration, as Python's tostring(encoding="UTF-8", xml_declaration=True). */
export const serializeXmlPart = (document: Document): Buffer => {
  const markup = new XMLSerializer()
    .serializeToString(document)
    .replace(LEADING_DECLARATION, '');
  return Buffer.from(`${UTF8_DECLARATION}\n${markup}`, 'utf8');
};
