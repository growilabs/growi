import { ConversionError } from '../conversion-error';
import { allocate, type Pdfium, release } from './runtime';

const unreadable = (): ConversionError =>
  new ConversionError('malformed', 'PDF page could not be read');

// With the u flag a surrogate range only matches an unpaired surrogate.
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

interface ActiveRange {
  readonly firstChar: number;
  readonly charCount: number;
  /** UTF-16 units the text of the range takes, its terminating NUL included. */
  readonly capacity: number;
}

// Port of pypdfium2's _get_active_text_range: characters without a text
// index at either end are left out, so PDFium never reads past the range
// (crbug.com/pdfium/2079), and the buffer is sized in text units.
const activeRange = (
  pdfium: Pdfium,
  textPage: number,
  count: number,
): ActiveRange | null => {
  const textIndex = (char: number): number =>
    pdfium.FPDFText_GetTextIndexFromCharIndex(textPage, char);
  let first = 0;
  while (first < count && textIndex(first) === -1) {
    first += 1;
  }
  if (first === count) {
    return null;
  }
  let last = count - 1;
  while (textIndex(last) === -1) {
    last -= 1;
  }
  return {
    firstChar: first,
    charCount: last - first + 1,
    capacity: textIndex(last) - textIndex(first) + 2,
  };
};

// UTF-16LE as pypdfium2 decodes it (errors="ignore"): a leading BOM stays,
// unpaired surrogates are dropped, and a real U+FFFD survives.
const decodeUtf16 = (
  heap: Uint8Array,
  pointer: number,
  units: number,
): string => {
  const text = Buffer.from(
    heap.buffer,
    heap.byteOffset + pointer,
    units * 2,
  ).toString('utf16le');
  return text.isWellFormed() ? text : text.replace(LONE_SURROGATE, '');
};

const readText = (pdfium: Pdfium, textPage: number): string => {
  const count = pdfium.FPDFText_CountChars(textPage);
  if (count < 0) {
    throw unreadable();
  }
  const range = activeRange(pdfium, textPage, count);
  if (range == null) {
    return '';
  }
  const buffer = allocate(pdfium, range.capacity * 2);
  try {
    const written = pdfium.FPDFText_GetText(
      textPage,
      range.firstChar,
      range.charCount,
      buffer,
    );
    if (written > range.capacity) {
      throw new ConversionError(
        'internal',
        'PDFium wrote past the text buffer',
      );
    }
    // `written` counts the terminating NUL; read HEAPU8 again as it may have been replaced.
    return written <= 1
      ? ''
      : decodeUtf16(pdfium.pdfium.HEAPU8, buffer, written - 1);
  } finally {
    release(pdfium, buffer);
  }
};

/** The raw text of one page, as PDFium lays it out. */
export const readPageText = (
  pdfium: Pdfium,
  document: number,
  index: number,
): string => {
  const page = pdfium.FPDF_LoadPage(document, index);
  if (page === 0) {
    throw unreadable();
  }
  try {
    const textPage = pdfium.FPDFText_LoadPage(page);
    if (textPage === 0) {
      throw unreadable();
    }
    try {
      return readText(pdfium, textPage);
    } finally {
      pdfium.FPDFText_ClosePage(textPage);
    }
  } finally {
    pdfium.FPDF_ClosePage(page);
  }
};
