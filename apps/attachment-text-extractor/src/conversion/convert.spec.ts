import { readFileSync } from 'node:fs';

import {
  buildCorruptPdf,
  buildDocx,
  buildEncryptedDocx,
  buildOwnerPasswordOnlyPdf,
  buildUserPasswordPdf,
  ENCRYPTED_MARKER,
  JAPANESE_SAMPLE,
  LEGACY_DOC_PATH,
  LEGACY_PPT_PATH,
  PLAIN_DOCUMENTS,
} from '../../test/fixtures';
import type {
  ConversionLimits,
  ConversionOutcome,
  PageInfo,
} from '../contract';
import { ConversionError } from './conversion-error';
import { convert } from './convert';
import { convertPptx } from './ooxml/pptx-split';
import { convertXlsx } from './ooxml/xlsx-split';
import { convertPdf } from './pdf';
import { conversionLimits } from './spec-support';

// The route converters keep their real behaviour; a test replaces one call to
// reach a state no real input produces reliably (empty slide lists, a thrown
// RangeError). This couples those tests to the route module names.
vi.mock('./pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pdf')>();
  return { ...actual, convertPdf: vi.fn(actual.convertPdf) };
});
vi.mock('./ooxml/pptx-split', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ooxml/pptx-split')>();
  return { ...actual, convertPptx: vi.fn(actual.convertPptx) };
});
vi.mock('./ooxml/xlsx-split', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ooxml/xlsx-split')>();
  return { ...actual, convertXlsx: vi.fn(actual.convertXlsx) };
});

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SECRET = 'SECRET-BODY';
const UNUSED = Buffer.from('unused');

const limits = (overrides: Partial<ConversionLimits> = {}): ConversionLimits =>
  conversionLimits({
    maxResultBytes: 1_000_000,
    maxPdfPages: 100,
    ...overrides,
  });

type Succeeded = Extract<ConversionOutcome, { kind: 'ok' }>;
type Failed = Extract<ConversionOutcome, { kind: 'failed' }>;

const succeed = async (
  bytes: Uint8Array,
  fileName: string,
  mimeHint: string | null = null,
  given: ConversionLimits = limits(),
): Promise<Succeeded> => {
  const outcome = await convert(bytes, fileName, mimeHint, given);
  if (outcome.kind !== 'ok') {
    throw new Error(
      `expected a result, got ${outcome.failure}: ${outcome.detail}`,
    );
  }
  return outcome;
};

const fail = async (
  bytes: Uint8Array,
  fileName: string,
  mimeHint: string | null = null,
  given: ConversionLimits = limits(),
): Promise<Failed> => {
  const outcome = await convert(bytes, fileName, mimeHint, given);
  if (outcome.kind !== 'failed') {
    throw new Error('expected a failure, got a result');
  }
  return outcome;
};

const joined = (outcome: Succeeded): string =>
  outcome.pages.map((page) => page.content).join('\n');

const numbersAndLabels = (outcome: Succeeded) =>
  outcome.pages.map((page) => [page.pageNumber, page.label]);

const page = (pageNumber: number | null, content: string): PageInfo => ({
  pageNumber,
  label: pageNumber == null ? null : String(pageNumber),
  content,
});

const EMPTY_RESULT: readonly PageInfo[] = [
  { pageNumber: null, label: null, content: '' },
];

afterEach(() => {
  vi.mocked(convertPdf).mockReset();
  vi.mocked(convertPptx).mockReset();
  vi.mocked(convertXlsx).mockReset();
});

describe('convert', () => {
  describe('units, numbers and labels per route', () => {
    it('returns one element per PDF page with its number and label', async () => {
      const outcome = await succeed(PLAIN_DOCUMENTS.pdfText.build(), 'a.pdf');

      expect(outcome.mimeType).toBe('application/pdf');
      expect(numbersAndLabels(outcome)).toEqual([
        [1, '1'],
        [2, '2'],
        [3, '3'],
      ]);
      expect(outcome.pages[1]?.content).toContain('PDF page 2');
    });

    it('turns an image-only PDF into one empty element', async () => {
      const outcome = await succeed(
        PLAIN_DOCUMENTS.pdfImageOnly.build(),
        'scan.pdf',
      );

      expect(outcome.pages).toEqual(EMPTY_RESULT);
    });

    it('returns one element per PPTX slide', async () => {
      const outcome = await succeed(
        PLAIN_DOCUMENTS.pptxMultiSlide.build(),
        'deck.pptx',
      );

      expect(outcome.mimeType).toBe(PPTX_MIME);
      expect(outcome.pages.length).toBeGreaterThan(1);
      expect(outcome.pages.map((p) => p.pageNumber)).toEqual(
        outcome.pages.map((_, index) => index + 1),
      );
      expect(outcome.pages.map((p) => p.label)).toEqual(
        outcome.pages.map((p) => String(p.pageNumber)),
      );
    });

    it('returns one element per non-empty XLSX sheet, keeping the original numbers', async () => {
      const outcome = await succeed(
        PLAIN_DOCUMENTS.xlsxMultiSheet.build(),
        'book.xlsx',
      );

      expect(outcome.mimeType).toBe(XLSX_MIME);
      // The third sheet ("Empty") is dropped; numbering of the others is untouched.
      expect(numbersAndLabels(outcome)).toEqual([
        [1, '売上'],
        [2, 'Summary <#1>'],
      ]);
    });

    it('returns one DOCX element without a page number', async () => {
      const outcome = await succeed(buildDocx(['本文']), 'a.docx');

      expect(outcome.mimeType).toBe(DOCX_MIME);
      expect(numbersAndLabels(outcome)).toEqual([[null, null]]);
      expect(outcome.pages[0]?.content).toContain('本文');
    });

    it.each([
      ['rtf', 'a.rtf', 'RTF body marker'],
      ['epub', 'a.epub', 'EPUB'],
      ['odt', 'a.odt', 'OpenDocument text marker'],
      ['ods', 'a.ods', ''],
      ['odp', 'a.odp', ''],
      ['xls', 'a.xls', 'XLS cell marker'],
    ] as const)('returns one element for %s', async (fixture, fileName, marker) => {
      const outcome = await succeed(PLAIN_DOCUMENTS[fixture].build(), fileName);

      expect(outcome.pages).toHaveLength(1);
      expect(numbersAndLabels(outcome)).toEqual([[null, null]]);
      expect(outcome.pages[0]?.content).toContain(marker);
      expect(outcome.pages[0]?.content).not.toBe('');
    });

    it.each([
      ['a.doc', LEGACY_DOC_PATH],
      ['a.ppt', LEGACY_PPT_PATH],
    ])('returns one element for the legacy binary %s', async (fileName, path) => {
      const outcome = await succeed(readFileSync(path), fileName);

      expect(outcome.pages).toHaveLength(1);
      expect(numbersAndLabels(outcome)).toEqual([[null, null]]);
      expect(outcome.pages[0]?.content.trim()).not.toBe('');
    });

    it.each([
      [
        'a.html',
        '<html><body><p>html marker</p></body></html>',
        'text/html',
        'html marker',
      ],
      [
        'a.xml',
        "<?xml version='1.0'?><r><i>xml marker</i></r>",
        'text/xml',
        'xml marker',
      ],
      [
        'a.ipynb',
        '{"cells":[{"cell_type":"markdown","source":["ipynb marker"]}],"nbformat":4,"nbformat_minor":5}',
        'application/x-ipynb+json',
        'ipynb marker',
      ],
      ['a.txt', 'txt marker', 'text/plain', 'txt marker'],
      ['a.csv', 'h1,h2\ncsv marker,2\n', 'text/csv', 'csv marker'],
      [
        'a.tsv',
        'h1\th2\ntsv marker\t2\n',
        'text/tab-separated-values',
        'tsv marker',
      ],
      ['a.md', '# md marker\n', 'text/markdown', 'md marker'],
      ['a.json', '{"k": "json marker"}', 'application/json', 'json marker'],
      ['a.yaml', 'k: yaml marker\n', 'text/yaml', 'yaml marker'],
    ])('returns one element without a page number for %s', async (fileName, data, mimeType, marker) => {
      const outcome = await succeed(Buffer.from(data), fileName);

      expect(outcome.mimeType).toBe(mimeType);
      expect(numbersAndLabels(outcome)).toEqual([[null, null]]);
      expect(outcome.pages[0]?.content).toContain(marker);
    });

    it('lets a MIME hint win over the extension', async () => {
      const outcome = await succeed(
        Buffer.from('plain words'),
        'noext.bin',
        'text/plain; charset=utf-8',
      );

      expect(outcome.mimeType).toBe('text/plain');
      expect(outcome.pages[0]?.content).toContain('plain words');
    });

    // test_types.py: the per-output cap is fixed at 10,000 characters, not a setting.
    it('caps one notebook output at 10,000 characters', async () => {
      const notebook = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          {
            cell_type: 'code',
            source: 'print(1)',
            outputs: [
              {
                output_type: 'stream',
                name: 'stdout',
                text: 'x'.repeat(10_001),
              },
            ],
          },
        ],
      };

      const outcome = await succeed(
        Buffer.from(JSON.stringify(notebook)),
        'a.ipynb',
      );

      expect(outcome.pages).toEqual([
        {
          pageNumber: null,
          label: null,
          content: `print(1)\n${'x'.repeat(10_000)}`,
        },
      ]);
    });
  });

  describe('normalization: newlines everywhere, Japanese joining only on the PDF route (Req 2.5)', () => {
    it('keeps the Japanese line break of plain text and unifies its newlines', async () => {
      const outcome = await succeed(
        Buffer.from('障害対応メモ\r\n本番環境で発生\r別行'),
        'memo.txt',
      );

      expect(outcome.pages[0]?.content).toBe(
        '障害対応メモ\n本番環境で発生\n別行',
      );
    });

    it('keeps a Japanese sample text as it is', async () => {
      const outcome = await succeed(Buffer.from(JAPANESE_SAMPLE), 'memo.txt');

      expect(
        outcome.pages[0]?.content.startsWith('障害対応メモ\n本番環境で発生'),
      ).toBe(true);
    });

    it('keeps the break between Japanese paragraphs of a DOCX', async () => {
      const outcome = await succeed(buildDocx([JAPANESE_SAMPLE]), 'memo.docx');

      const content = outcome.pages[0]?.content ?? '';
      expect(content).not.toContain('障害対応メモ本番環境');
      expect(content).toMatch(/障害対応メモ\\?\n+本番環境で発生/);
    });

    it('unifies newlines in every element', async () => {
      vi.mocked(convertPptx).mockResolvedValueOnce([page(1, 'a\r\nb\rc')]);

      const outcome = await succeed(UNUSED, 'x.pptx');

      expect(outcome.pages).toEqual([page(1, 'a\nb\nc')]);
    });
  });

  describe('empty-element rule', () => {
    it('drops empty elements and keeps the original numbers', async () => {
      vi.mocked(convertPdf).mockResolvedValueOnce([
        page(1, 'first'),
        page(2, ''),
        page(3, '\r\n'),
        page(4, 'fourth'),
      ]);

      const outcome = await succeed(UNUSED, 'x.pdf');

      // "\r\n" is a newline only, not empty: only truly empty content is dropped.
      expect(outcome.pages.map((p) => p.pageNumber)).toEqual([1, 3, 4]);
    });

    it('turns an empty slide list into one empty element', async () => {
      vi.mocked(convertPptx).mockResolvedValueOnce([]);

      expect((await succeed(UNUSED, 'x.pptx')).pages).toEqual(EMPTY_RESULT);
    });

    it('turns an empty sheet list into one empty element', async () => {
      vi.mocked(convertXlsx).mockResolvedValueOnce([]);

      expect((await succeed(UNUSED, 'x.xlsx')).pages).toEqual(EMPTY_RESULT);
    });

    it('passes a fallback element without a number through', async () => {
      const whole: PageInfo = {
        pageNumber: null,
        label: null,
        content: 'whole book',
      };
      vi.mocked(convertXlsx).mockResolvedValueOnce([whole]);

      expect((await succeed(UNUSED, 'x.xlsx')).pages).toEqual([whole]);
    });

    it('turns an empty text file into one empty element', async () => {
      expect((await succeed(Buffer.alloc(0), 'empty.txt')).pages).toEqual(
        EMPTY_RESULT,
      );
    });
  });

  describe('failure classification', () => {
    it.each([
      ['mail.msg', 'application/vnd.ms-outlook'],
      ['mail.msg', null],
      ['noextension', null],
      ['a.exe', null],
    ])('classifies %s (MIME %s) as unsupported', async (fileName, mimeHint) => {
      const outcome = await fail(Buffer.from('data'), fileName, mimeHint);

      expect(outcome.failure).toBe('unsupported');
    });

    it('classifies an encrypted DOCX as encrypted', async () => {
      expect((await fail(buildEncryptedDocx(), 'a.docx')).failure).toBe(
        'encrypted',
      );
    });

    it('classifies a PDF that needs a user password as encrypted', async () => {
      expect((await fail(buildUserPasswordPdf(), 'a.pdf')).failure).toBe(
        'encrypted',
      );
    });

    it('extracts a PDF restricted by an owner password only', async () => {
      const outcome = await succeed(buildOwnerPasswordOnlyPdf(), 'a.pdf');

      expect(joined(outcome)).toContain('PDF page 1');
    });

    it('classifies a corrupt PDF as malformed', async () => {
      expect((await fail(buildCorruptPdf(), 'a.pdf')).failure).toBe(
        'malformed',
      );
    });

    it('classifies a corrupt DOCX as malformed', async () => {
      expect(
        (await fail(Buffer.from('not a zip at all'), 'a.docx')).failure,
      ).toBe('malformed');
    });

    it('classifies a PDF over the page limit as limit_exceeded', async () => {
      const outcome = await fail(
        PLAIN_DOCUMENTS.pdfText.build(),
        'a.pdf',
        null,
        limits({ maxPdfPages: 2 }),
      );

      expect(outcome.failure).toBe('limit_exceeded');
    });

    it('classifies an encrypted DOCX without its text in the outcome', async () => {
      const outcome = await fail(buildEncryptedDocx(), 'a.docx');

      expect(JSON.stringify(outcome)).not.toContain(ENCRYPTED_MARKER);
    });
  });

  describe('result size limit (counted in UTF-8 bytes after normalization)', () => {
    it('classifies a result over the limit as result_too_large', async () => {
      const outcome = await fail(
        Buffer.from('x'.repeat(101)),
        'a.txt',
        null,
        limits({ maxResultBytes: 100 }),
      );

      expect(outcome.failure).toBe('result_too_large');
    });

    it('passes a result of exactly the limit', async () => {
      const outcome = await succeed(
        Buffer.from('x'.repeat(100)),
        'a.txt',
        null,
        limits({ maxResultBytes: 100 }),
      );

      expect(outcome.pages[0]?.content).toBe('x'.repeat(100));
    });

    it('counts UTF-8 bytes, not characters', async () => {
      // 40 characters, 120 UTF-8 bytes.
      const outcome = await fail(
        Buffer.from('あ'.repeat(40)),
        'a.txt',
        null,
        limits({ maxResultBytes: 100 }),
      );

      expect(outcome.failure).toBe('result_too_large');
    });

    it('sums the limit across elements', async () => {
      vi.mocked(convertPdf).mockResolvedValueOnce([
        page(1, 'x'.repeat(60)),
        page(2, 'x'.repeat(60)),
      ]);

      const outcome = await fail(
        UNUSED,
        'a.pdf',
        null,
        limits({ maxResultBytes: 100 }),
      );

      expect(outcome.failure).toBe('result_too_large');
    });

    it('ignores dropped empty elements and counts normalized newlines', async () => {
      vi.mocked(convertPdf).mockResolvedValueOnce([
        page(1, 'a\r\nb'),
        page(2, ''),
      ]);

      // "a\nb" is 3 bytes after normalization; "a\r\nb" would be 4.
      const outcome = await succeed(
        UNUSED,
        'a.pdf',
        null,
        limits({ maxResultBytes: 3 }),
      );

      expect(outcome.pages).toHaveLength(1);
    });
  });

  describe('unexpected errors', () => {
    it.each([
      ['RangeError', new RangeError(SECRET)],
      ['TypeError', new TypeError(SECRET)],
      ['Error', new Error(SECRET)],
    ])('turns a thrown %s into internal named by its class only', async (name, thrown) => {
      vi.mocked(convertPdf).mockRejectedValueOnce(thrown);

      const outcome = await fail(UNUSED, 'a.pdf');

      expect(outcome.failure).toBe('internal');
      expect(outcome.detail).toBe(name);
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    });

    it.each([
      ['a string', SECRET],
      ['a plain object', { message: SECRET }],
    ])('turns %s thrown by a converter into internal without its content', async (_name, thrown) => {
      vi.mocked(convertPdf).mockRejectedValueOnce(thrown);

      const outcome = await fail(UNUSED, 'a.pdf');

      expect(outcome.failure).toBe('internal');
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    });

    it('keeps the kind and detail of a ConversionError from a converter', async () => {
      vi.mocked(convertXlsx).mockRejectedValueOnce(
        new ConversionError('limit_exceeded', 'too many cells'),
      );

      const outcome = await fail(UNUSED, 'a.xlsx');

      expect([outcome.failure, outcome.detail]).toEqual([
        'limit_exceeded',
        'too many cells',
      ]);
    });
  });

  describe('input size caps enforced by convert itself (without the parent pre-check)', () => {
    const capped = limits({ maxCsvBytes: 100, maxHtmlBytes: 200 });

    it('classifies a CSV over the cap as limit_exceeded', async () => {
      // 104 bytes
      const outcome = await fail(
        Buffer.from('a,b\n'.repeat(26)),
        'a.csv',
        null,
        capped,
      );

      expect(outcome.failure).toBe('limit_exceeded');
    });

    it('converts a CSV at the cap', async () => {
      // 100 bytes
      const outcome = await succeed(
        Buffer.from('a,b\n'.repeat(25)),
        'a.csv',
        null,
        capped,
      );

      expect(outcome.pages[0]?.content).toContain('a');
    });

    it('classifies an HTML over the cap as limit_exceeded', async () => {
      // 208 bytes
      const outcome = await fail(
        Buffer.from('<p>x</p>'.repeat(26)),
        'a.html',
        null,
        capped,
      );

      expect(outcome.failure).toBe('limit_exceeded');
    });

    it('converts an HTML at the cap', async () => {
      // 200 bytes
      const outcome = await succeed(
        Buffer.from('<p>x</p>'.repeat(25)),
        'a.html',
        null,
        capped,
      );

      expect(outcome.pages[0]?.content.startsWith('x')).toBe(true);
    });

    it('leaves plain text unaffected by the CSV and HTML caps', async () => {
      const outcome = await succeed(
        Buffer.from('plain text'),
        'a.txt',
        null,
        limits({ maxCsvBytes: 1, maxHtmlBytes: 1 }),
      );

      expect(outcome.pages[0]?.content).toBe('plain text');
    });
  });
});
