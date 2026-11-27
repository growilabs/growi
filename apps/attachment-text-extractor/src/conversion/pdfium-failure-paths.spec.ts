import { buildTextPdf, PDF_PAGE_TEXTS } from '../../test/fixtures';
import { convertPdf } from './pdf';
import { conversionErrorOf, conversionLimits } from './spec-support';

// PDFium is an external boundary: the real module runs, and a test can make
// the next call into it abort. As with a real Emscripten module after
// abort(), every later call into that same instance throws as well.
const pdfiumFault = vi.hoisted(() => ({ abortNextCall: false }));

vi.mock('@embedpdf/pdfium', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@embedpdf/pdfium')>();
  const abortable = <T extends object>(wrapped: T): T => {
    let aborted = false;
    return new Proxy(wrapped, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (
          typeof property !== 'string' ||
          !property.startsWith('FPDF') ||
          typeof value !== 'function'
        ) {
          return value;
        }
        return (...args: unknown[]) => {
          if (pdfiumFault.abortNextCall) {
            pdfiumFault.abortNextCall = false;
            aborted = true;
          }
          if (aborted) {
            throw new WebAssembly.RuntimeError(
              'Aborted(native code called abort())',
            );
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
  };
  return {
    ...actual,
    init: vi.fn(async (...args: Parameters<typeof actual.init>) =>
      abortable(await actual.init(...args)),
    ),
  };
});

const limits = conversionLimits();

/** A text PDF whose trailer carries the given /Encrypt dictionary entries. */
const securityHandlerPdf = (encrypt: string): Buffer =>
  Buffer.from(
    buildTextPdf(PDF_PAGE_TEXTS)
      .toString('latin1')
      .replace(
        '/Root 1 0 R',
        `/Root 1 0 R /Encrypt << ${encrypt} >> /ID [<00> <00>]`,
      ),
    'latin1',
  );

describe('convertPdf failure paths', () => {
  afterEach(() => {
    pdfiumFault.abortNextCall = false;
  });

  // PDFium reports these as FPDF_ERR_SECURITY, as the Python service's pypdfium2 does.
  it.each([
    ['an unknown', '/Filter /Unknown /V 1 /R 2 /O <00> /U <00> /P -4'],
    [
      'a public-key (PubSec)',
      '/Filter /Adobe.PubSec /SubFilter /adbe.pkcs7.s5 /V 4 /R 4 /Recipients [<3000>] /P -4',
    ],
  ])('classifies a PDF protected by %s security handler as encrypted', async (_name, encrypt) => {
    const failure = await conversionErrorOf(() =>
      convertPdf(securityHandlerPdf(encrypt), limits),
    );

    expect(failure.kind).toBe('encrypted');
  });

  it('converts the next PDF in the same process after PDFium aborted', async () => {
    await convertPdf(buildTextPdf(['warm up']), limits);
    pdfiumFault.abortNextCall = true;
    const failure = await conversionErrorOf(() =>
      convertPdf(buildTextPdf(PDF_PAGE_TEXTS), limits),
    );
    expect(failure.kind).toBe('internal');

    const pages = await convertPdf(buildTextPdf(PDF_PAGE_TEXTS), limits);

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[1]?.content).toContain('PDF page 2');
  });
});
