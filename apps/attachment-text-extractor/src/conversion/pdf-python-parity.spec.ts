import { buildPdf, type PdfObject } from '../../test/fixtures/pdf';
import { convertPdf } from './pdf';
import { conversionErrorOf, conversionLimits } from './spec-support';

// Behaviour the Python service (pypdfium2) shows and the PDFium WASM build
// does not give by itself.
//
// The text PDFium hands back is decoded as the Python service decodes it
// (pypdfium2's get_text_range: UTF-16LE with errors="ignore", no BOM
// handling). Each glyph code below is mapped by the font's ToUnicode CMap to
// the UTF-16BE units given, so the page carries exactly those code units.
const GLYPHS: ReadonlyMap<string, string> = new Map([
  ['A', '0041'],
  ['bom', 'FEFF'],
  ['loneHigh', 'D800'],
  ['loneLow', 'DC00'],
  ['replacement', 'FFFD'],
  ['nonCharacter', 'FFFE'],
  ['kanjiOutsideBmp', 'D842DFB7'],
  ['hiragana', '3042'],
]);

const toUnicodeCmap = (): string => {
  const entries = [...GLYPHS.values()]
    .map((units, i) => `<${(i + 1).toString(16).padStart(4, '0')}> <${units}>`)
    .join('\n');
  return (
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n' +
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def\n' +
    '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
    `${GLYPHS.size} beginbfchar\n${entries}\nendbfchar\n` +
    'endcmap CMapName currentdict /CMap defineresource pop end end'
  );
};

/** One page showing the named glyphs in order. */
const glyphPdf = (names: readonly string[]): Buffer => {
  const codes = [...GLYPHS.keys()];
  const shown = names
    .map((name) => (codes.indexOf(name) + 1).toString(16).padStart(4, '0'))
    .join('');
  const fonts: PdfObject[] = [
    '<< /Type /Font /Subtype /Type0 /BaseFont /TestFont /Encoding /Identity-H /DescendantFonts [5 0 R] /ToUnicode 6 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestFont /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> >>',
    { dictionary: '', data: Buffer.from(toUnicodeCmap(), 'latin1') },
  ];
  return buildPdf(
    [
      {
        resources: '<< /Font << /F1 4 0 R >> >>',
        content: `BT /F1 24 Tf 72 700 Td <${shown}> Tj ET`,
      },
    ],
    fonts,
  );
};

const pageText = async (names: readonly string[]): Promise<string> => {
  const pages = await convertPdf(glyphPdf(names), conversionLimits());
  expect(pages).toHaveLength(1);
  return pages[0]?.content ?? '';
};

describe('convertPdf decodes page text as the Python service does', () => {
  it('keeps a byte order mark at the start of the page text', async () => {
    expect(await pageText(['bom', 'A', 'A'])).toBe('﻿AA');
  });

  it.each([
    ['a lone high surrogate', ['A', 'loneHigh', 'A'], 'AA'],
    ['a lone low surrogate', ['A', 'loneLow', 'A'], 'AA'],
    [
      'a lone high surrogate before a pair',
      ['A', 'loneHigh', 'kanjiOutsideBmp', 'A'],
      'A𠮷A',
    ],
  ])('drops %s and keeps the rest', async (_name, names, expected) => {
    const text = await pageText(names);

    expect(text).toBe(expected);
    expect(text.isWellFormed()).toBe(true);
  });

  it('keeps a replacement character that is really on the page', async () => {
    expect(await pageText(['A', 'replacement', 'A'])).toBe('A�A');
  });

  it('keeps a character outside the BMP whole', async () => {
    expect(await pageText(['A', 'kanjiOutsideBmp', 'A', 'hiragana'])).toBe(
      'A𠮷Aあ',
    );
  });

  it.each([
    ['at the start', ['nonCharacter', 'A'], 'A'],
    ['at the end', ['A', 'nonCharacter'], 'A'],
    ['at both ends', ['nonCharacter', 'A', 'nonCharacter'], 'A'],
    ['in the middle', ['A', 'nonCharacter', 'A'], 'AA'],
    ['only', ['nonCharacter', 'nonCharacter'], ''],
  ])('leaves out characters PDFium excludes from the text (%s)', async (_name, names, expected) => {
    expect(await pageText(names)).toBe(expected);
  });
});

describe('convertPdf opens PDFs as the Python service does', () => {
  it('classifies a PDF whose page tree is empty as malformed', async () => {
    const failure = await conversionErrorOf(() =>
      convertPdf(buildPdf([]), conversionLimits()),
    );

    expect(failure.kind).toBe('malformed');
  });
});
