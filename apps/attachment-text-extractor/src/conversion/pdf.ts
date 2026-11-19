import type { ConversionLimits, PageInfo } from '../contract';
import { ConversionError } from './conversion-error';
import { joinBrokenJapanese, normalizeNewlines } from './normalize';
import {
  discardPdfium,
  loadPdfium,
  readPageText,
  withPdfDocument,
} from './pdfium';

/**
 * One element per page, pages without text included (convert drops them).
 * The page text is not capped here: MAX_RESULT_BYTES applies to the whole result.
 */
export const convertPdf = async (
  bytes: Uint8Array,
  limits: ConversionLimits,
): Promise<readonly PageInfo[]> => {
  try {
    const pdfium = await loadPdfium();
    return withPdfDocument(pdfium, bytes, (document) => {
      const count = pdfium.FPDF_GetPageCount(document);
      // The native PDFium the Python service uses refuses to open a PDF
      // without pages; this build opens it, so the outcome is matched here.
      if (count <= 0) {
        throw new ConversionError('malformed', 'PDF could not be opened');
      }
      // Checked before reading any page, so a forged page tree costs nothing.
      if (count > limits.maxPdfPages) {
        throw new ConversionError(
          'limit_exceeded',
          'PDF page count exceeds the limit',
        );
      }
      return Array.from({ length: count }, (_, index) => ({
        pageNumber: index + 1,
        label: String(index + 1),
        // PDFium separates lines with CRLF; the gap closing relies on LF.
        content: joinBrokenJapanese(
          normalizeNewlines(readPageText(pdfium, document, index)),
        ),
      }));
    });
  } catch (thrown) {
    if (thrown instanceof ConversionError && thrown.kind !== 'internal') {
      throw thrown;
    }
    discardPdfium();
    // An abort inside PDFium surfaces as a RuntimeError; its message is not carried over.
    throw thrown instanceof ConversionError
      ? thrown
      : new ConversionError(
          'internal',
          `unexpected ${thrown instanceof Error ? thrown.name : 'non-Error value'} from PDFium`,
        );
  }
};
