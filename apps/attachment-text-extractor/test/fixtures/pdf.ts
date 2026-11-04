import { startOffsets } from './offsets';
import {
  type PdfEncryption,
  type StandardSecurityHandler,
  standardSecurityHandler,
} from './pdf-security';

// A hand-assembled PDF, ported from `_build_pdf` in the Python service's
// tests/fixture_files.py so the bytes stay identical (research.md 9.4).

export interface PdfStreamObject {
  /** Dictionary entries without `<<`, `>>` and `/Length`. */
  readonly dictionary: string;
  readonly data: Uint8Array;
}

/** An object body: a literal (dictionary, number, ...) or a stream. */
export type PdfObject = string | PdfStreamObject;

export interface PdfPage {
  /** The page's `/Resources` value, e.g. `<< /Font << /F1 3 0 R >> >>`. */
  readonly resources: string;
  readonly content: string;
}

const HEADER = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1');
const HELVETICA_RESOURCES = '<< /Font << /F1 3 0 R >> >>';

const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');

// Only streams are encrypted: the objects written here hold no literal strings.
const objectBody = (
  object: PdfObject,
  objectNumber: number,
  security?: StandardSecurityHandler,
): Buffer => {
  if (typeof object === 'string') {
    return latin1(object);
  }
  const data =
    security == null
      ? object.data
      : security.encryptStream(objectNumber, object.data);
  return Buffer.concat([
    latin1(`<< ${object.dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    latin1('\nendstream'),
  ]);
};

const xrefAndTrailer = (
  offsets: readonly number[],
  xrefAt: number,
  trailerExtra: string,
): Buffer => {
  const size = offsets.length + 1;
  const rows = offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  return latin1(
    `xref\n0 ${size}\n0000000000 65535 f \n${rows}` +
      `trailer\n<< /Size ${size} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xrefAt}\n%%EOF\n`,
  );
};

const serialize = (
  objects: readonly PdfObject[],
  security?: StandardSecurityHandler,
  trailerExtra = '',
): Buffer => {
  const bodies = objects.map((object, i) =>
    Buffer.concat([
      latin1(`${i + 1} 0 obj\n`),
      objectBody(object, i + 1, security),
      latin1('\nendobj\n'),
    ]),
  );
  const offsets = startOffsets(
    HEADER.length,
    bodies.map((body) => body.length),
  );
  const head = Buffer.concat([HEADER, ...bodies]);
  return Buffer.concat([
    head,
    xrefAndTrailer(offsets, head.length, trailerExtra),
  ]);
};

// The /Encrypt dictionary goes last, so the other object numbers stay as in
// the unencrypted file.
const serializeEncrypted = (
  objects: readonly PdfObject[],
  encryption: PdfEncryption,
): Buffer => {
  const security = standardSecurityHandler(encryption);
  const id = encryption.fileId.toString('hex');
  return serialize(
    [...objects, security.dictionary],
    security,
    ` /Encrypt ${objects.length + 1} 0 R /ID [<${id}> <${id}>]`,
  );
};

/**
 * Object 1 is the catalog, 2 the page tree, 3 Helvetica (resource `/F1`),
 * then `extraObjects` from 4, then a page and its content stream per page.
 */
export const buildPdf = (
  pages: readonly PdfPage[],
  extraObjects: readonly PdfObject[] = [],
  encryption?: PdfEncryption,
): Buffer => {
  const firstPage = 4 + extraObjects.length;
  const kids = pages.map((_, i) => `${firstPage + 2 * i} 0 R`).join(' ');
  const pageObjects = pages.flatMap((page, i): PdfObject[] => [
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${page.resources} /Contents ${firstPage + 2 * i + 1} 0 R >>`,
    { dictionary: '', data: latin1(page.content) },
  ]);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...extraObjects,
    ...pageObjects,
  ];
  return encryption == null
    ? serialize(objects)
    : serializeEncrypted(objects, encryption);
};

const assertPrintableAscii = (text: string): void => {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) {
      throw new Error(
        `buildTextPdf writes printable ASCII only: ${JSON.stringify(text)}`,
      );
    }
  }
};

const pdfString = (text: string): string => text.replace(/[\\()]/g, '\\$&');

/** One page per text, each drawn in Helvetica. */
export const buildTextPdf = (
  pageTexts: readonly string[],
  encryption?: PdfEncryption,
): Buffer => {
  pageTexts.forEach(assertPrintableAscii);
  return buildPdf(
    pageTexts.map((text) => ({
      resources: HELVETICA_RESOURCES,
      content: `BT /F1 24 Tf 72 700 Td (${pdfString(text)}) Tj ET`,
    })),
    [],
    encryption,
  );
};

const IMAGE_SIDE = 16;

/** One page that draws a small grayscale image and no text. */
export const buildImageOnlyPdf = (): Buffer => {
  const pixels = Buffer.from(
    Array.from({ length: IMAGE_SIDE * IMAGE_SIDE }, (_, i) => (i * 7) % 256),
  );
  const image: PdfStreamObject = {
    dictionary: `/Type /XObject /Subtype /Image /Width ${IMAGE_SIDE} /Height ${IMAGE_SIDE} /ColorSpace /DeviceGray /BitsPerComponent 8`,
    data: pixels,
  };
  return buildPdf(
    [
      {
        resources: '<< /XObject << /Im1 4 0 R >> >>',
        content: 'q 200 0 0 200 100 400 cm /Im1 Do Q',
      },
    ],
    [image],
  );
};
