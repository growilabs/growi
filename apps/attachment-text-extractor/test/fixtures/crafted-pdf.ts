import { PDF_PAGE_TEXTS } from './documents';
import { buildPdf, buildTextPdf, type PdfObject } from './pdf';
import type { PdfEncryption } from './pdf-security';
import { createRandomBytes } from './seeded-random';

// PDFs crafted in the Python service's tests/fixture_files.py,
// conversion/test_pdf.py, runner/test_child_isolation.py and the
// end-to-end / child-entry tests.

export const PDF_USER_PASSWORD = 'pdf-user-password';
export const PDF_OWNER_PASSWORD = 'pdf-owner-password';
// Any fixed 16 bytes: the file ID only has to stay the same between builds.
const FILE_ID = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

const encrypted = (encryption: Omit<PdfEncryption, 'fileId'>): Buffer =>
  buildTextPdf(PDF_PAGE_TEXTS, { ...encryption, fileId: FILE_ID });

/** Opens only with a password. */
export const buildUserPasswordPdf = (): Buffer =>
  encrypted({
    userPassword: PDF_USER_PASSWORD,
    ownerPassword: PDF_OWNER_PASSWORD,
  });

/** Restricts permissions only: opens, and reads, with no password. */
export const buildOwnerPasswordOnlyPdf = (): Buffer =>
  encrypted({ userPassword: '', ownerPassword: PDF_OWNER_PASSWORD });

/** The header and the start of the first object, then 512 random bytes. */
export const buildCorruptPdf = (): Buffer => {
  const text = buildTextPdf(PDF_PAGE_TEXTS);
  const kept = text.indexOf('1 0 obj') + 20;
  return Buffer.concat([text.subarray(0, kept), createRandomBytes(7)(512)]);
};

export const pdfHeaderFollowedBy = (text: string): Buffer =>
  Buffer.from(`%PDF-1.4\n${text}`, 'latin1');

export const buildGarbagePdf = (): Buffer =>
  Buffer.from(`%PDF-1.7\n${'\u0000garbage'.repeat(100)}`, 'latin1');

const hex4 = (value: number): string =>
  value.toString(16).toUpperCase().padStart(4, '0');

const toUnicodeCmap = (codes: ReadonlyMap<string, number>): string => {
  const bfchar = [...codes]
    .map(
      ([char, code]) => `<${hex4(code)}> <${hex4(char.codePointAt(0) ?? 0)}>\n`,
    )
    .join('');
  return (
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    `${codes.size} beginbfchar\n${bfchar}` +
    'endbfchar\nendcmap CMapName currentdict /CMap defineresource pop end end'
  );
};

/**
 * One page whose lines are drawn far apart, shown through a Type0 font with a
 * ToUnicode map so no CJK font is embedded (Python's `_japanese_lines_pdf`).
 * Characters must be in the BMP.
 */
export const buildJapaneseLinesPdf = (lines: readonly string[]): Buffer => {
  const codes = new Map(
    [...new Set([...lines.join('')])].map((char, i) => [char, i + 1]),
  );
  const fonts: PdfObject[] = [
    '<< /Type /Font /Subtype /Type0 /BaseFont /TestFont /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>',
    { dictionary: '', data: Buffer.from(toUnicodeCmap(codes), 'latin1') },
  ];
  const shown = lines
    .map((line, i) => {
      const glyphs = [...line].map((char) => hex4(codes.get(char) ?? 0));
      return `1 0 0 1 72 ${700 - 100 * i} Tm <${glyphs.join('')}> Tj\n`;
    })
    .join('');
  return buildPdf(
    [
      {
        resources: '<< /Font << /F1 4 0 R >> >>',
        content: `BT /F1 24 Tf\n${shown}ET`,
      },
    ],
    fonts,
  );
};

/**
 * One page showing 4,000,000 characters in strings of 1000 (pdfium caps one
 * string operand at 32767 characters).
 */
export const buildLongPagePdf = (): Buffer =>
  buildPdf([
    {
      resources: '<< /Font << /F1 3 0 R >> >>',
      content: `BT /F1 1 Tf 72 700 Td\n${`(${'a'.repeat(1000)}) Tj 0 -1 Td\n`.repeat(4000)}ET`,
    },
  ]);
