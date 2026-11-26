import type { PageInfo } from '../contract';
import { normalizeNewlines } from './normalize';
import { spendResultBudget } from './result-budget';

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
    totalBytes = spendResultBudget(totalBytes, content, maxResultBytes);
    kept.push({ pageNumber: page.pageNumber, label: page.label, content });
  }
  return kept.length > 0 ? kept : EMPTY_RESULT;
};
