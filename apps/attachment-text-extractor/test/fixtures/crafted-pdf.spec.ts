import {
  buildCorruptPdf,
  buildGarbagePdf,
  buildJapaneseLinesPdf,
  buildLongPagePdf,
  buildOwnerPasswordOnlyPdf,
  buildUserPasswordPdf,
  pdfHeaderFollowedBy,
} from './crafted-pdf';
import { buildTextPdf } from './pdf';
import { anydocErrorCode, anydocMarkdown } from './spec-support';

const PAGE_TEXTS = ['PDF page 1', 'PDF page 2', 'PDF page 3'];

const trailer = (pdf: Buffer): string => {
  const text = pdf.toString('latin1');
  return text.slice(text.lastIndexOf('trailer'));
};

const encryptDictionary = (pdf: Buffer): string => {
  const text = pdf.toString('latin1');
  const number = /\/Encrypt (\d+) 0 R/.exec(trailer(pdf))?.[1];
  const start = text.indexOf(`\n${number} 0 obj\n`);
  return text.slice(start, text.indexOf('endobj', start));
};

describe.each([
  ['user password', buildUserPasswordPdf],
  ['owner password only', buildOwnerPasswordOnlyPdf],
] as const)('PDF with a %s', (_, build) => {
  it('carries a Standard security handler, RC4 128-bit revision 3, and a file ID', () => {
    const pdf = build();

    expect(trailer(pdf)).toMatch(
      /\/Encrypt \d+ 0 R \/ID \[<[0-9a-f]{32}> <[0-9a-f]{32}>\]/,
    );
    expect(encryptDictionary(pdf)).toMatch(
      /\/Filter \/Standard \/V 2 \/R 3 \/Length 128 \/P -?\d+ \/O <[0-9a-f]{64}> \/U <[0-9a-f]{64}>/,
    );
  });

  it('encrypts the page content, so no page text is readable in the file', () => {
    const pdf = build().toString('latin1');

    for (const text of PAGE_TEXTS) {
      expect(pdf).not.toContain(text);
    }
    expect(buildTextPdf(PAGE_TEXTS).toString('latin1')).toContain('PDF page 1');
  });
});

describe('password kinds as anydoc sees them', () => {
  it('refuses the PDF that needs a user password as encrypted', async () => {
    expect(await anydocErrorCode(buildUserPasswordPdf(), 'pdf')).toBe(
      'encrypted',
    );
  });

  it('opens the owner-password-only PDF with no password and reads every page', async () => {
    const markdown = await anydocMarkdown(buildOwnerPasswordOnlyPdf(), 'pdf');

    expect(markdown).toMatch(/PDF page 1[\s\S]*PDF page 2[\s\S]*PDF page 3/);
  });

  it('writes different owner keys for the two, since only one has a user password', () => {
    const ownerKey = (pdf: Buffer) =>
      /\/O <([0-9a-f]+)>/.exec(encryptDictionary(pdf))?.[1];

    expect(ownerKey(buildUserPasswordPdf())).not.toBe(
      ownerKey(buildOwnerPasswordOnlyPdf()),
    );
  });
});

describe('buildCorruptPdf', () => {
  it('keeps the header and the start of the first object, then garbage with no xref or trailer', async () => {
    const pdf = buildCorruptPdf();
    const text = buildTextPdf(PAGE_TEXTS);
    const kept = text.indexOf('1 0 obj') + 20;

    expect(pdf.subarray(0, kept)).toEqual(text.subarray(0, kept));
    expect(pdf.length).toBe(kept + 512);
    expect(pdf.toString('latin1')).not.toMatch(/xref|trailer|startxref/);
    expect(await anydocErrorCode(pdf, 'pdf')).toBe('malformed');
  });
});

describe('PDFs that are not PDFs past the header', () => {
  it('follows the header with text only', async () => {
    const pdf = pdfHeaderFollowedBy('CONTENT_MARKER');

    expect(pdf.toString('latin1')).toBe('%PDF-1.4\nCONTENT_MARKER');
    expect(await anydocErrorCode(pdf, 'pdf')).toBe('malformed');
  });

  it('follows a PDF 1.7 header with repeated NUL garbage', async () => {
    const pdf = buildGarbagePdf();

    expect(pdf.toString('latin1')).toBe(
      `%PDF-1.7\n${'\u0000garbage'.repeat(100)}`,
    );
    expect(await anydocErrorCode(pdf, 'pdf')).toBe('malformed');
  });
});

describe('buildJapaneseLinesPdf', () => {
  it('shows each line through a Type0 font with a ToUnicode map, which anydoc extracts', async () => {
    const pdf = buildJapaneseLinesPdf(['日本', '語です']);

    const markdown = await anydocMarkdown(pdf, 'pdf');

    expect(pdf.toString('latin1')).toMatch(
      /\/Subtype \/Type0[^\n]*\/ToUnicode/,
    );
    expect(markdown).toContain('日本');
    expect(markdown).toContain('語です');
  });
});

describe('buildLongPagePdf', () => {
  it('writes one page that shows 4,000,000 characters in 4,000 strings', () => {
    const pdf = buildLongPagePdf().toString('latin1');

    const strings = [...pdf.matchAll(/\((a+)\) Tj 0 -1 Td/g)];

    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(1);
    expect(strings).toHaveLength(4000);
    expect(strings.every((match) => match[1].length === 1000)).toBe(true);
  });
});
