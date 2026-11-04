import type { BenchmarkFormat, DocumentAnswer, ExpectedPage } from './answers';
import { isPlainCharacter } from './plain-character';

/** A corpus document built in-process, with the answer it is scored against. */
export interface GeneratedDocument {
  readonly answer: DocumentAnswer;
  readonly build: () => Buffer;
}

/** A Japanese PDF that Chromium prints from HTML (needs Chromium to build). */
export interface ChromiumPdfDocument {
  readonly answer: DocumentAnswer;
  /** CSS for the page body; the font is added by the renderer. */
  readonly style: string;
  /** The body HTML of each printed page, in order. */
  readonly pages: readonly string[];
}

/**
 * The `sourceCharacters` of an answer: each distinct character of the given
 * source texts that is neither printable ASCII nor whitespace, in code point
 * order. Markup may be passed whole; its syntax is ASCII.
 */
export const sourceCharactersOf = (...texts: readonly string[]): string =>
  [...new Set(texts.join('\n'))]
    .filter((char) => !isPlainCharacter(char))
    .sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0))
    .join('');

/** The `pages[]` of a format the service returns as one element. */
export const SINGLE_PAGE: readonly ExpectedPage[] = [
  { pageNumber: null, label: null },
];

export const MIME_TYPES = {
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  doc: 'application/msword',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
} as const satisfies Record<BenchmarkFormat, string>;
