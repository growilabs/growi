export const SEARCH_HISTORY_KEYWORD_MAX_LENGTH = 200;

/** Trimmed keyword, or null when it must not be saved (empty, or longer than the max in code points). */
export const toSearchHistoryKeyword = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  if (Array.from(trimmed).length > SEARCH_HISTORY_KEYWORD_MAX_LENGTH) {
    return null;
  }
  return trimmed;
};

/** `"<trimmed input>"`; used for the exact-match method item. Returns '' for a blank input. */
export const toExactMatchKeyword = (input: string): string => {
  const trimmed = input.trim();
  return trimmed === '' ? '' : `"${trimmed}"`;
};
