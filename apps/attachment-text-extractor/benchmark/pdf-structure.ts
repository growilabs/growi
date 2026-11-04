// Reads a Chromium-written PDF's object dictionaries as text. Chromium (Skia)
// writes them uncompressed, so a scan of the bytes finds them.

/** The number of page objects (`/Type /Page`, not `/Pages`). */
export const pdfPageCount = (pdf: Buffer): number =>
  pdf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g)?.length ?? 0;

/** The `/FontName` of every embedded font descriptor, e.g. `ABCDEF+BIZUDGothic-Regular`. */
export const pdfFontNames = (pdf: Buffer): string[] =>
  [...pdf.toString('latin1').matchAll(/\/FontName\s*\/([^\s/<>[\]()]+)/g)].map(
    ([, name]) => name,
  );

/**
 * The number of Type3 fonts: glyphs drawn as paths, which Chromium writes for
 * a font it cannot embed (CFF, variable) or for synthesized bold.
 */
export const pdfType3FontCount = (pdf: Buffer): number =>
  pdf.toString('latin1').match(/\/Subtype\s*\/Type3\b/g)?.length ?? 0;
