import { cutText } from '../../tools/page-content';
import type { PageReadBudget } from './request-context';

type PageSlice = {
  readonly content?: string;
  readonly hasMore?: boolean;
  readonly outline?: readonly unknown[];
};

export const isPageReadBudgetExhausted = (budget: PageReadBudget): boolean =>
  budget.used >= budget.limit;

// Keeps the leading outline entries whose JSON array fits in `room`; the
// count is exactly JSON.stringify(outline).length.
const fitOutline = <T extends PageSlice>(
  page: T,
  room: number,
): { page: T; outlineChars: number } => {
  if (page.outline == null) {
    return { page, outlineChars: 0 };
  }
  let chars = '[]'.length;
  let count = 0;
  for (const entry of page.outline) {
    const entryChars = JSON.stringify(entry).length + (count > 0 ? 1 : 0);
    if (chars + entryChars > room) break;
    chars += entryChars;
    count += 1;
  }
  if (chars > room) {
    return { page: { ...page, outline: undefined }, outlineChars: 0 };
  }
  return count === page.outline.length
    ? { page, outlineChars: chars }
    : {
        page: { ...page, outline: page.outline.slice(0, count) },
        outlineChars: chars,
      };
};

/**
 * Charges one tool result against the remaining budget, in characters: the
 * outline as the LLM receives it (serialised), then the body. Whatever does
 * not fit is cut at the remaining room; a cut body is reported as `hasMore`.
 */
export const fitPageToBudget = <T extends PageSlice>(
  slice: T,
  remaining: number,
): { page: T; consumed: number } => {
  const { page, outlineChars } = fitOutline(slice, remaining);
  if (page.content == null) {
    return { page, consumed: outlineChars };
  }

  const contentRoom = Math.max(0, remaining - outlineChars);
  if (page.content.length <= contentRoom) {
    return { page, consumed: outlineChars + page.content.length };
  }
  const content = cutText(page.content, contentRoom);
  return {
    page: { ...page, content, hasMore: true },
    consumed: outlineChars + content.length,
  };
};
