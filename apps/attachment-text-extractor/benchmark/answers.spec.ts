import { readdirSync } from 'node:fs';

import {
  BENCHMARK_CORPUS_DIR,
  type DocumentAnswer,
  loadBenchmarkAnswers,
  parseBenchmarkAnswers,
} from './answers';
import { declaredAnswers } from './corpus';

const committed = loadBenchmarkAnswers();

const corpusFiles = (): string[] =>
  readdirSync(BENCHMARK_CORPUS_DIR).filter((name) => !name.startsWith('.'));

const JAPANESE = /[぀-ヿ一-鿿]/u;

const validDocument = (): DocumentAnswer => ({
  fileName: 'a.txt',
  format: 'txt',
  mimeType: 'text/plain',
  source: 'hand-written',
  encoding: 'utf-8',
  features: [],
  expectedPages: [{ pageNumber: null, label: null }],
  phrases: [{ text: '議事録', page: 1 }],
});

const withDocument = (document: unknown): unknown => ({
  version: 1,
  documents: [document],
});

describe('answers.json', () => {
  it('matches the schema', () => {
    expect(committed.documents.length).toBeGreaterThan(0);
  });

  it('has one answer for every corpus file, and names no file outside the corpus', () => {
    const answered = committed.documents.map((document) => document.fileName);

    expect([...answered].sort()).toEqual(corpusFiles().sort());
  });

  it('is what the corpus declarations write (regenerate with pnpm benchmark:generate)', () => {
    expect(committed).toEqual(declaredAnswers());
  });

  // Req 2.7: each listed format has a Japanese document.
  it.each([
    'pdf',
    'docx',
    'xlsx',
    'pptx',
    'xls',
    'csv',
    'html',
    'txt',
  ] as const)('has a document with Japanese phrases in %s', (format) => {
    const japanese = committed.documents.filter(
      (document) =>
        document.format === format &&
        document.phrases.some((phrase) => JAPANESE.test(phrase.text)),
    );

    expect(japanese.length).toBeGreaterThan(0);
  });

  // Req 2.4: the corpus carries these encodings and layouts.
  it.each([
    'shift_jis',
    'euc-jp',
    'iso-2022-jp',
    'utf-8-bom',
    'utf-16le-bom',
    'utf-16be-bom',
  ] as const)('has a text document encoded in %s', (encoding) => {
    expect(
      committed.documents.some(
        (document) =>
          document.format === 'txt' && document.encoding === encoding,
      ),
    ).toBe(true);
  });

  it.each([
    ['pdf', 'horizontal-writing'],
    ['pdf', 'vertical-writing'],
    ['pdf', 'line-break-inside-word'],
    ['html', 'meta-charset'],
    ['html', 'script-style'],
    ['docx', 'paragraph-line-break'],
  ] as const)('has a %s document with the feature %s', (format, feature) => {
    expect(
      committed.documents.some(
        (document) =>
          document.format === format && document.features.includes(feature),
      ),
    ).toBe(true);
  });

  it('marks where a line break falls inside a word in the line-break PDF', () => {
    const broken = committed.documents
      .filter((document) =>
        document.features.includes('line-break-inside-word'),
      )
      .flatMap((document) => document.phrases)
      .filter((phrase) => phrase.lineBreakAfter != null);

    expect(broken.length).toBeGreaterThan(0);
  });
});

describe('parseBenchmarkAnswers', () => {
  it('accepts a valid document', () => {
    const parsed = parseBenchmarkAnswers(withDocument(validDocument()));

    expect(parsed.documents[0].phrases[0]).toEqual({ text: '議事録', page: 1 });
  });

  it.each<[string, unknown, RegExp]>([
    ['a non-object', 'answers', /answers: expected an object/],
    ['an unknown version', { version: 2, documents: [] }, /version/],
    [
      'an unknown format',
      withDocument({ ...validDocument(), format: 'docm' }),
      /documents\[0\]\.format/,
    ],
    [
      'a phrase on a page past the expected pages',
      withDocument({ ...validDocument(), phrases: [{ text: 'x', page: 2 }] }),
      /documents\[0\]\.phrases\[0\]\.page/,
    ],
    [
      'a document without phrases',
      withDocument({ ...validDocument(), phrases: [] }),
      /documents\[0\]\.phrases/,
    ],
    [
      'a line break outside the phrase',
      withDocument({
        ...validDocument(),
        phrases: [{ text: '議事録', page: 1, lineBreakAfter: 3 }],
      }),
      /lineBreakAfter/,
    ],
    [
      'a page number that is neither a number nor null',
      withDocument({
        ...validDocument(),
        expectedPages: [{ pageNumber: '1', label: null }],
      }),
      /expectedPages\[0\]\.pageNumber/,
    ],
    [
      'an unknown encoding',
      withDocument({ ...validDocument(), encoding: 'utf-7' }),
      /documents\[0\]\.encoding/,
    ],
    [
      'a file name with a directory',
      withDocument({ ...validDocument(), fileName: '../a.txt' }),
      /documents\[0\]\.fileName/,
    ],
    [
      'two answers for one file',
      { version: 1, documents: [validDocument(), validDocument()] },
      /documents\[1\]\.fileName: duplicate/,
    ],
  ])('rejects %s', (_case, value, message) => {
    expect(() => parseBenchmarkAnswers(value)).toThrow(message);
  });
});
