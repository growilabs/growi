import { ConversionError } from './conversion-error';
import type { LfText } from './normalize';

/**
 * Bytes used after adding one element's content: its UTF-8 bytes, label and
 * page number not counted (research.md §9.7). The content is taken already
 * unified to LF, so each caller unifies it once. Throws result_too_large once
 * the total passes maxResultBytes.
 */
export const spendResultBudget = (
  usedBytes: number,
  content: LfText,
  maxResultBytes: number,
): number => {
  const total = usedBytes + Buffer.byteLength(content, 'utf8');
  if (total > maxResultBytes) {
    throw new ConversionError(
      'result_too_large',
      'extracted text exceeds the result limit',
    );
  }
  return total;
};
