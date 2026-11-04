import { type Browser, chromium } from 'playwright-core';

import { isBenchmarkFontSubset } from './benchmark-font';
import type { ChromiumPdfDocument } from './corpus-document';
import { pdfFontNames, pdfType3FontCount } from './pdf-structure';

// Prints HTML to PDF with the Chromium that playwright-core finds in its
// browser cache (~/.cache/ms-playwright, installed by `pnpm exec playwright
// install chromium` at the repository root).

const FONT_FAMILY = 'BenchmarkJP';

// Only the regular face is loaded, so headings stay regular: synthesized bold
// would be written as Type3 glyphs.
const htmlFor = (
  document: ChromiumPdfDocument,
  fontDataUrl: string,
): string => {
  const pages = document.pages
    .map((body) => `<section class="page">${body}</section>`)
    .join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
@font-face { font-family: "${FONT_FAMILY}"; src: url(${fontDataUrl}) format("truetype"); }
body { font-family: "${FONT_FAMILY}"; font-synthesis: none; margin: 0; }
h1, h2 { font-weight: normal; }
.page { break-after: page; }
.page:last-child { break-after: auto; }
${document.style}
</style></head><body>${pages}</body></html>`;
};

// A missing glyph would fall back to a system font, and a font Chromium cannot
// embed would become Type3 glyphs; either makes the PDF unlike a real one.
const checkFonts = (fileName: string, pdf: Buffer): void => {
  const stray = pdfFontNames(pdf).filter(
    (name) => !isBenchmarkFontSubset(name),
  );
  const type3 = pdfType3FontCount(pdf);
  if (stray.length > 0 || type3 > 0) {
    throw new Error(
      `${fileName}: unexpected fonts [${stray.join(', ')}], ${type3} Type3 font(s)`,
    );
  }
};

const printOne = async (
  browser: Browser,
  document: ChromiumPdfDocument,
  fontDataUrl: string,
): Promise<Buffer> => {
  const page = await browser.newPage();
  try {
    await page.setContent(htmlFor(document, fontDataUrl));
    // Runs in the page, where `document` is the DOM's.
    const loaded = await page.evaluate(
      (family) =>
        globalThis.document.fonts.ready.then(() =>
          globalThis.document.fonts.check(`16px "${family}"`),
        ),
      FONT_FAMILY,
    );
    if (!loaded) {
      throw new Error(`${document.answer.fileName}: the font did not load`);
    }
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    });
    checkFonts(document.answer.fileName, pdf);
    return pdf;
  } finally {
    await page.close();
  }
};

/** Prints each document, in the given order, with the TrueType font embedded as a data URL. */
export const renderPdfs = async (
  documents: readonly ChromiumPdfDocument[],
  font: Uint8Array,
): Promise<Buffer[]> => {
  const fontDataUrl = `data:font/ttf;base64,${Buffer.from(font).toString('base64')}`;
  const browser = await chromium.launch();
  try {
    return await Promise.all(
      documents.map((document) => printOne(browser, document, fontDataUrl)),
    );
  } finally {
    await browser.close();
  }
};
