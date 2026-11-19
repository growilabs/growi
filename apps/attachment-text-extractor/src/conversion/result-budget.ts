import { ConversionError } from './conversion-error';
import { normalizeNewlines } from './normalize';

/**
 * Bytes used after adding one element's content: UTF-8 bytes with newlines
 * unified to LF, label and page number not counted (research.md §9.7). Throws
 * result_too_large once the total passes maxResultBytes.
 */
export const spendResultBudget = (
  usedBytes: number,
  content: string,
  maxResultBytes: number,
): number => {
  const total =
    usedBytes + Buffer.byteLength(normalizeNewlines(content), 'utf8');
  if (total > maxResultBytes) {
    throw new ConversionError(
      'result_too_large',
      'extracted text exceeds the result limit',
    );
  }
  return total;
};
