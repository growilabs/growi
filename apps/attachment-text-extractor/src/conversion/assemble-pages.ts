import type { PageInfo } from '../contract';
import { ConversionError } from './conversion-error';
import { normalizeNewlines } from './normalize';

const EMPTY_RESULT: readonly PageInfo[] = [
  { pageNumber: null, label: null, content: '' },
];

/**
 * Unifies newlines, drops empty elements (keeping the others' numbers) and
 * returns at least one element; a result over maxResultBytes UTF-8 bytes
 * rejects with result_too_large.
 */
export const assemblePages = (
  pages: readonly PageInfo[],
  maxResultBytes: number,
): readonly PageInfo[] => {
  const kept: PageInfo[] = [];
  let totalBytes = 0;
  for (const page of pages) {
    const content = normalizeNewlines(page.content);
    if (content === '') {
      continue;
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
    // Checked per element so an oversized result stops before it grows further.
    if (totalBytes > maxResultBytes) {
      throw new ConversionError(
        'result_too_large',
        'extracted text exceeds the result limit',
      );
    }
    kept.push({ pageNumber: page.pageNumber, label: page.label, content });
  }
  return kept.length > 0 ? kept : EMPTY_RESULT;
};
