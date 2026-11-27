import type { ConversionLimits, PageInfo } from '../contract';
import { ConversionError } from './conversion-error';
import { joinBrokenJapanese, normalizeNewlines } from './normalize';
import {
  discardPdfium,
  loadPdfium,
  readPageText,
  withPdfDocument,
} from './pdfium';
import { spendResultBudget } from './result-budget';

/**
 * One element per page, pages without text included (convert drops them).
 * The text of a single page is not capped; MAX_RESULT_BYTES applies to the running total.
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
      const pages: PageInfo[] = [];
      let usedBytes = 0;
      for (let index = 0; index < count; index++) {
        // PDFium separates lines with CRLF; the gap closing relies on LF.
        const content = joinBrokenJapanese(
          normalizeNewlines(readPageText(pdfium, document, index)),
        );
        usedBytes = spendResultBudget(
          usedBytes,
          content,
          limits.maxResultBytes,
        );
        pages.push({
          pageNumber: index + 1,
          label: String(index + 1),
          content,
        });
      }
      return pages;
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
