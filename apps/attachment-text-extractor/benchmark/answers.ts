import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The schema of answers.json: what the search-quality benchmark expects each
// corpus document to yield (requirements Req 2.7-2.9). run-benchmark reads it
// through loadBenchmarkAnswers, so the types here are its contract.

export const BENCHMARK_CORPUS_DIR = fileURLToPath(
  new URL('./corpus/', import.meta.url),
);
export const BENCHMARK_ANSWERS_PATH = fileURLToPath(
  new URL('./answers.json', import.meta.url),
);

export const BENCHMARK_FORMATS = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'xls',
  'csv',
  'html',
  'txt',
  'doc',
  'ppt',
  'odt',
  'ods',
  'odp',
] as const;
export type BenchmarkFormat = (typeof BENCHMARK_FORMATS)[number];

/** How a text document's bytes are encoded. */
export const BENCHMARK_ENCODINGS = [
  'utf-8',
  'utf-8-bom',
  'utf-16le-bom',
  'utf-16be-bom',
  'shift_jis',
  'cp932',
  'euc-jp',
  'iso-2022-jp',
] as const;
export type BenchmarkEncoding = (typeof BENCHMARK_ENCODINGS)[number];

/** Traits a report can group results by (Req 2.4). */
export const BENCHMARK_FEATURES = [
  'horizontal-writing',
  'vertical-writing',
  'line-break-inside-word',
  'meta-charset',
  'script-style',
  'paragraph-line-break',
] as const;
export type BenchmarkFeature = (typeof BENCHMARK_FEATURES)[number];

/** One element of the `pages[]` the service is expected to return, in order. */
export interface ExpectedPage {
  readonly pageNumber: number | null;
  readonly label: string | null;
  /**
   * XLSX only: the sheet's name in the workbook. Kept apart from `label`,
   * which is the service's choice (the Python service sends the name).
   */
  readonly sheetName?: string;
}

export interface ExpectedPhrase {
  /**
   * Text a search must find. The benchmark matches it as written, and again
   * with whitespace removed (research.md 12).
   */
  readonly text: string;
  /** 1-based index into `expectedPages`: the PDF page, slide or sheet. */
  readonly page: number;
  /**
   * The rendered document wraps this phrase onto the next line after this
   * many characters (Unicode code points), so an extractor may split it there.
   */
  readonly lineBreakAfter?: number;
}

export interface DocumentAnswer {
  /** A file directly under corpus/. */
  readonly fileName: string;
  readonly format: BenchmarkFormat;
  /** The MIME type to send with the file to POST /extract. */
  readonly mimeType: string;
  /** How the file was made: the generator, or where it was copied from. */
  readonly source: string;
  readonly encoding?: BenchmarkEncoding;
  readonly features: readonly BenchmarkFeature[];
  readonly expectedPages: readonly ExpectedPage[];
  readonly phrases: readonly ExpectedPhrase[];
  /** Text in the file that must not reach the extracted text (script, style). */
  readonly absentPhrases?: readonly string[];
  /**
   * Every character of the document's source text that is neither printable
   * ASCII nor whitespace, in code point order. An extracted character outside
   * this set counts as mojibake (research.md 12). Absent when the source text
   * is not declared in benchmark/ (the Apache POI files).
   */
  readonly sourceCharacters?: string;
}

export interface BenchmarkAnswers {
  readonly version: 1;
  readonly documents: readonly DocumentAnswer[];
}

type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const fail = (path: string, problem: string): never => {
  throw new Error(`${path}: ${problem}`);
};

const fieldsAt = (value: unknown, path: string): Fields =>
  isFields(value) ? value : fail(path, 'expected an object');

const arrayAt = (value: unknown, path: string): readonly unknown[] =>
  Array.isArray(value) ? value : fail(path, 'expected an array');

const stringAt = (value: unknown, path: string): string =>
  typeof value === 'string' && value.length > 0
    ? value
    : fail(path, 'expected a non-empty string');

const positiveIntegerAt = (value: unknown, path: string): number =>
  Number.isInteger(value) && typeof value === 'number' && value > 0
    ? value
    : fail(path, 'expected a positive integer');

const oneOf = <T extends string>(
  options: readonly T[],
  value: unknown,
  path: string,
): T =>
  options.find((option) => option === value) ??
  fail(path, `expected one of ${options.join(', ')}`);

const optional = <T>(
  value: unknown,
  path: string,
  parse: (value: unknown, path: string) => T,
): T | undefined => (value === undefined ? undefined : parse(value, path));

const parsePage = (value: unknown, path: string): ExpectedPage => {
  const fields = fieldsAt(value, path);
  const pageNumber =
    fields.pageNumber === null
      ? null
      : positiveIntegerAt(fields.pageNumber, `${path}.pageNumber`);
  const label =
    fields.label === null ? null : stringAt(fields.label, `${path}.label`);
  const sheetName = optional(fields.sheetName, `${path}.sheetName`, stringAt);
  return sheetName === undefined
    ? { pageNumber, label }
    : { pageNumber, label, sheetName };
};

const parsePhrase = (
  value: unknown,
  path: string,
  pageCount: number,
): ExpectedPhrase => {
  const fields = fieldsAt(value, path);
  const text = stringAt(fields.text, `${path}.text`);
  const page = positiveIntegerAt(fields.page, `${path}.page`);
  if (page > pageCount) {
    fail(`${path}.page`, `only ${pageCount} expected page(s)`);
  }
  const lineBreakAfter = optional(
    fields.lineBreakAfter,
    `${path}.lineBreakAfter`,
    positiveIntegerAt,
  );
  if (lineBreakAfter === undefined) {
    return { text, page };
  }
  if (lineBreakAfter >= [...text].length) {
    fail(`${path}.lineBreakAfter`, 'must fall inside the phrase');
  }
  return { text, page, lineBreakAfter };
};

const listAt = <T>(
  value: unknown,
  path: string,
  parse: (item: unknown, path: string) => T,
): T[] =>
  arrayAt(value, path).map((item, index) => parse(item, `${path}[${index}]`));

const parseDocument = (value: unknown, path: string): DocumentAnswer => {
  const fields = fieldsAt(value, path);
  const fileName = stringAt(fields.fileName, `${path}.fileName`);
  if (/[/\\]/.test(fileName) || fileName.startsWith('.')) {
    fail(`${path}.fileName`, 'expected a plain file name under corpus/');
  }
  const expectedPages = listAt(
    fields.expectedPages,
    `${path}.expectedPages`,
    parsePage,
  );
  if (expectedPages.length === 0) {
    fail(`${path}.expectedPages`, 'expected at least one page');
  }
  const phrases = listAt(fields.phrases, `${path}.phrases`, (item, at) =>
    parsePhrase(item, at, expectedPages.length),
  );
  if (phrases.length === 0) {
    fail(`${path}.phrases`, 'expected at least one phrase');
  }
  const encoding = optional(fields.encoding, `${path}.encoding`, (item, at) =>
    oneOf(BENCHMARK_ENCODINGS, item, at),
  );
  const absentPhrases = optional(
    fields.absentPhrases,
    `${path}.absentPhrases`,
    (item, at) => listAt(item, at, stringAt),
  );
  const sourceCharacters = optional(
    fields.sourceCharacters,
    `${path}.sourceCharacters`,
    stringAt,
  );
  return {
    fileName,
    format: oneOf(BENCHMARK_FORMATS, fields.format, `${path}.format`),
    mimeType: stringAt(fields.mimeType, `${path}.mimeType`),
    source: stringAt(fields.source, `${path}.source`),
    ...(encoding === undefined ? {} : { encoding }),
    features: listAt(fields.features, `${path}.features`, (item, at) =>
      oneOf(BENCHMARK_FEATURES, item, at),
    ),
    expectedPages,
    phrases,
    ...(absentPhrases === undefined ? {} : { absentPhrases }),
    ...(sourceCharacters === undefined ? {} : { sourceCharacters }),
  };
};

/** Checks parsed JSON against the schema; throws naming the first bad field. */
export const parseBenchmarkAnswers = (value: unknown): BenchmarkAnswers => {
  const fields = fieldsAt(value, 'answers');
  if (fields.version !== 1) {
    fail('answers.version', 'expected 1');
  }
  const documents = listAt(fields.documents, 'documents', parseDocument);
  documents.forEach((document, index) => {
    if (documents.findIndex((d) => d.fileName === document.fileName) < index) {
      fail(`documents[${index}].fileName`, `duplicate ${document.fileName}`);
    }
  });
  return { version: 1, documents };
};

export const loadBenchmarkAnswers = (
  path: string = BENCHMARK_ANSWERS_PATH,
): BenchmarkAnswers =>
  parseBenchmarkAnswers(JSON.parse(readFileSync(path, 'utf8')));
