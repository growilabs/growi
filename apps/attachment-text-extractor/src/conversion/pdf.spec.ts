import { inspect } from 'node:util';

import {
  buildCorruptPdf,
  buildImageOnlyPdf,
  buildJapaneseLinesPdf,
  buildOwnerPasswordOnlyPdf,
  buildTextPdf,
  buildUserPasswordPdf,
  PDF_PAGE_TEXTS,
  PDF_USER_PASSWORD,
  pdfHeaderFollowedBy,
} from '../../test/fixtures';
import { convertPdf } from './pdf';
import { conversionErrorOf, conversionLimits } from './spec-support';

const limits = (maxPdfPages = 100) => conversionLimits({ maxPdfPages });

// PDFium is an external boundary: the real module runs unless a test asks for
// one of the two failures research.md 14.8 measured under RLIMIT_AS (malloc
// returning 0, and abort() surfacing as a RuntimeError).
const pdfiumFault = vi.hoisted(() => ({
  mallocReturnsZero: false,
  abortOnCall: false,
}));

vi.mock('@embedpdf/pdfium', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@embedpdf/pdfium')>();
  const abort = (): never => {
    throw new WebAssembly.RuntimeError('Aborted(native code called abort())');
  };
  const faultyRuntime = <T extends object>(runtime: T): T =>
    new Proxy(runtime, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === 'wasmExports' && pdfiumFault.mallocReturnsZero) {
          // The exports object is frozen, so a copy carries the failing malloc.
          return { ...value, malloc: () => 0 };
        }
        if (property === '_malloc' && pdfiumFault.mallocReturnsZero) {
          return () => 0;
        }
        return value;
      },
    });
  const faultyModule = <T extends object>(wrapped: T): T =>
    new Proxy(wrapped, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (
          property === 'pdfium' &&
          typeof value === 'object' &&
          value != null
        ) {
          return faultyRuntime(value);
        }
        if (
          pdfiumFault.abortOnCall &&
          typeof property === 'string' &&
          property.startsWith('FPDF') &&
          typeof value === 'function'
        ) {
          return abort;
        }
        return value;
      },
    });
  return {
    ...actual,
    init: vi.fn(async (...args: Parameters<typeof actual.init>) =>
      faultyModule(await actual.init(...args)),
    ),
  };
});

const textPdf = (): Buffer => buildTextPdf(PDF_PAGE_TEXTS);

describe('convertPdf', () => {
  it('returns one element per page with a one-based number and label', async () => {
    const pages = await convertPdf(textPdf(), limits());

    expect(pages.map((p) => [p.pageNumber, p.label])).toEqual([
      [1, '1'],
      [2, '2'],
      [3, '3'],
    ]);
    pages.forEach((page, index) => {
      expect(page.content).toContain(`PDF page ${index + 1}`);
    });
  });

  it('returns page content free of carriage returns', async () => {
    const pages = await convertPdf(textPdf(), limits());

    expect(pages.every((p) => !p.content.includes('\r'))).toBe(true);
  });

  describe('page count limit', () => {
    it('accepts a page count equal to the limit', async () => {
      expect(await convertPdf(textPdf(), limits(3))).toHaveLength(3);
    });

    it('rejects a page count over the limit as limit_exceeded', async () => {
      const failure = await conversionErrorOf(() =>
        convertPdf(textPdf(), limits(2)),
      );

      expect(failure.kind).toBe('limit_exceeded');
    });
  });

  describe('protected and unreadable PDFs', () => {
    it('classifies a PDF that needs a user password as encrypted without naming the password', async () => {
      const failure = await conversionErrorOf(() =>
        convertPdf(buildUserPasswordPdf(), limits()),
      );

      expect(failure.kind).toBe('encrypted');
      expect(failure.detail).not.toContain(PDF_USER_PASSWORD);
    });

    it('extracts a PDF restricted by an owner password only', async () => {
      const pages = await convertPdf(buildOwnerPasswordOnlyPdf(), limits());

      expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
      expect(pages[1]?.content).toContain('PDF page 2');
    });

    it('keeps the page of an image-only PDF with empty text', async () => {
      const pages = await convertPdf(buildImageOnlyPdf(), limits());

      expect(
        pages.map((p) => [p.pageNumber, p.label, p.content.trim()]),
      ).toEqual([[1, '1', '']]);
    });

    it('classifies a corrupt PDF as malformed', async () => {
      const failure = await conversionErrorOf(() =>
        convertPdf(buildCorruptPdf(), limits()),
      );

      expect(failure.kind).toBe('malformed');
    });

    it.each([
      ['empty bytes', Buffer.alloc(0)],
      ['plain text', Buffer.from('not a pdf at all')],
    ])('classifies %s as malformed', async (_name, bytes) => {
      const failure = await conversionErrorOf(() =>
        convertPdf(bytes, limits()),
      );

      expect(failure.kind).toBe('malformed');
    });

    it('never carries file content into what a log line would print', async () => {
      const secret = 'TOPSECRET-BODY';

      const failure = await conversionErrorOf(() =>
        convertPdf(pdfHeaderFollowedBy(`${secret}\n garbage`), limits()),
      );

      expect(inspect(failure, { depth: 10 })).not.toContain(secret);
    });
  });

  describe('PDFium running out of WASM memory (research.md 14.8)', () => {
    afterEach(() => {
      pdfiumFault.mallocReturnsZero = false;
      pdfiumFault.abortOnCall = false;
    });

    it('classifies a malloc that returns 0 as internal instead of writing at address 0', async () => {
      pdfiumFault.mallocReturnsZero = true;

      const failure = await conversionErrorOf(() =>
        convertPdf(textPdf(), limits()),
      );

      expect(failure.kind).toBe('internal');
      expect(inspect(failure, { depth: 10 })).not.toContain('PDF page');
    });

    it('classifies an abort inside PDFium as internal without its message', async () => {
      pdfiumFault.abortOnCall = true;

      const failure = await conversionErrorOf(() =>
        convertPdf(textPdf(), limits()),
      );

      expect(failure.kind).toBe('internal');
      expect(failure.detail).not.toContain('native code called abort()');
    });
  });

  describe('Japanese line-break joining (the PDF route only, Req 2.5)', () => {
    it('closes the gap between two Japanese lines', async () => {
      const pages = await convertPdf(
        buildJapaneseLinesPdf(['日本', '語です']),
        limits(),
      );

      expect(pages[0]?.content.trim()).toBe('日本語です');
    });

    it('keeps the break between a Japanese line and an ASCII line', async () => {
      const pages = await convertPdf(
        buildJapaneseLinesPdf(['日本', 'ABC']),
        limits(),
      );

      expect(pages[0]?.content).toContain('日本\nABC');
    });

    it('leaves ASCII page text as it is', async () => {
      const pages = await convertPdf(buildTextPdf(['Hello world']), limits());

      expect(pages[0]?.content.trim()).toBe('Hello world');
    });
  });
});
