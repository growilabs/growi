import type { ConversionLimits, PageInfo } from '../contract';
import type {
  AnydocFormat,
  ResolvedFormat,
  Route,
  TextKind,
} from '../formats/format-table';
import { ConversionError } from './conversion-error';

// Every converter is imported only when its route runs: a child converts one
// file, so a PDF child never loads anydoc and no other child loads PDFium
// (research.md 27.3).

type RouteConverter = (
  bytes: Uint8Array,
  format: ResolvedFormat,
  limits: ConversionLimits,
) => Promise<readonly PageInfo[]>;

type TextConverter = (bytes: Uint8Array) => Promise<string>;

const whole = (content: string): readonly PageInfo[] => [
  { pageNumber: null, label: null, content },
];

const TEXT_CONVERTERS: Readonly<Record<TextKind, TextConverter>> = {
  plain: async (bytes) =>
    (await import('./text/plain-text')).plainToText(bytes),
  html: async (bytes) => (await import('./text/html')).htmlToText(bytes),
  xml: async (bytes) => (await import('./text/xml-text')).xmlToText(bytes),
  ipynb: async (bytes) => {
    const ipynb = await import('./text/ipynb');
    return ipynb.ipynbToText(bytes, ipynb.IPYNB_OUTPUT_MAX_CHARS);
  },
  csv: async (bytes) => (await import('./text/csv')).csvToText(bytes),
};

const anydocFormatOf = (format: ResolvedFormat): AnydocFormat => {
  if (format.anydocFormat == null) {
    throw new ConversionError(
      'internal',
      'office route without an anydoc format',
    );
  }
  return format.anydocFormat;
};

const textKindOf = (format: ResolvedFormat): TextKind => {
  if (format.textKind == null) {
    throw new ConversionError('internal', 'text route without a text kind');
  }
  return format.textKind;
};

const ROUTE_CONVERTERS: Readonly<Record<Route, RouteConverter>> = {
  pdf: async (bytes, _format, limits) =>
    (await import('./pdf')).convertPdf(bytes, limits),
  pptx: async (bytes, _format, limits) =>
    (await import('./ooxml/pptx-split')).convertPptx(bytes, limits),
  xlsx: async (bytes, _format, limits) =>
    (await import('./ooxml/xlsx-split')).convertXlsx(bytes, limits),
  office: async (bytes, format) => {
    const { convertOffice } = await import('./office');
    return whole(await convertOffice(bytes, anydocFormatOf(format)));
  },
  text: async (bytes, format) =>
    whole(await TEXT_CONVERTERS[textKindOf(format)](bytes)),
};

/** The route's elements before normalization; failures reject. */
export const convertByRoute = (
  bytes: Uint8Array,
  format: ResolvedFormat,
  limits: ConversionLimits,
): Promise<readonly PageInfo[]> =>
  ROUTE_CONVERTERS[format.route](bytes, format, limits);
