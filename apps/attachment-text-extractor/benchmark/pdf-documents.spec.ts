import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { anydocMarkdown } from '../test/fixtures/spec-support';
import { BENCHMARK_CORPUS_DIR } from './answers';
import { isBenchmarkFontSubset } from './benchmark-font';
import { CHROMIUM_PDF_DOCUMENTS } from './pdf-documents';
import { pdfFontNames, pdfPageCount, pdfType3FontCount } from './pdf-structure';
import { isPlainCharacter } from './plain-character';
import { pdfPageTexts } from './spec-support';

// The PDFs need Chromium to build, so the specs read the committed files
// only; `pnpm benchmark:generate` rebuilds them.

const WHITESPACE = /\s+/gu;

const cases = CHROMIUM_PDF_DOCUMENTS.map(
  ({ answer }) =>
    [
      answer.fileName,
      answer,
      readFileSync(join(BENCHMARK_CORPUS_DIR, answer.fileName)),
    ] as const,
);

describe.each(cases)('%s', (_fileName, answer, pdf) => {
  it('is a PDF with one page per expected page', () => {
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfPageCount(pdf)).toBe(answer.expectedPages.length);
  });

  it('embeds only a TrueType subset of the benchmark font, as ordinary PDF text extraction expects', () => {
    const fonts = pdfFontNames(pdf);

    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.filter((font) => !isBenchmarkFontSubset(font))).toEqual([]);
    expect(pdfType3FontCount(pdf)).toBe(0);
  });

  it('carries every expected phrase on its expected page, and on no other page', () => {
    // A phrase cut by a line break is matched with the break removed.
    const pages = pdfPageTexts(pdf).map((text) => text.replaceAll('\n', ''));

    expect(pages).toHaveLength(answer.expectedPages.length);
    for (const phrase of answer.phrases) {
      const holding = pages.flatMap((text, index) =>
        text.includes(phrase.text) ? [index + 1] : [],
      );
      expect({ phrase: phrase.text, pages: holding }).toEqual({
        phrase: phrase.text,
        pages: [phrase.page],
      });
    }
  });
});

describe.each(cases)('%s source characters', (_fileName, answer, pdf) => {
  it('declare every character the PDF holds beyond printable ASCII and whitespace', () => {
    const declared = new Set(answer.sourceCharacters ?? '');
    const undeclared = [...new Set(pdfPageTexts(pdf).join('\n'))].filter(
      (char) => !isPlainCharacter(char) && !declared.has(char),
    );

    expect(undeclared).toEqual([]);
  });
});

describe.each(
  cases.filter(([, answer]) =>
    answer.features.includes('line-break-inside-word'),
  ),
)('%s line breaks', (_fileName, answer, pdf) => {
  it('fall inside the marked phrases, where the answer says, and nowhere else in them', () => {
    const pages = pdfPageTexts(pdf);

    for (const { text, page, lineBreakAfter } of answer.phrases) {
      const chars = [...text];
      const printed =
        lineBreakAfter == null
          ? text
          : `${chars.slice(0, lineBreakAfter).join('')}\n${chars.slice(lineBreakAfter).join('')}`;
      expect(pages[page - 1]).toContain(printed);
    }
    expect(
      answer.phrases.filter((phrase) => phrase.lineBreakAfter != null).length,
    ).toBeGreaterThan(0);
  });
});

// anydoc 0.2.4 (pdf-inspector) reads horizontal text, but reorders vertical
// text across columns (research.md 11), so only horizontal PDFs are checked.
describe.each(
  cases.filter(([, answer]) => answer.features.includes('horizontal-writing')),
)('%s through anydoc', (_fileName, answer, pdf) => {
  it('yields every expected phrase once whitespace is ignored', async () => {
    const text = (await anydocMarkdown(pdf, 'pdf')).replace(WHITESPACE, '');

    for (const phrase of answer.phrases) {
      expect(text).toContain(phrase.text.replace(WHITESPACE, ''));
    }
  });
});
