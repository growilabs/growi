import type { QueryTerms } from '~/server/interfaces/search';

// Free-text part of QueryTerms: the only terms matched against attachment content.
export type AttachmentKeywordTerms = Pick<
  QueryTerms,
  'match' | 'not_match' | 'phrase' | 'not_phrase'
>;

// Operator part of QueryTerms: applied to the parent page, never to attachment content.
export type PageFilterTerms = Omit<QueryTerms, keyof AttachmentKeywordTerms>;

export const EMPTY_ATTACHMENT_KEYWORD_TERMS: AttachmentKeywordTerms = {
  match: [],
  not_match: [],
  phrase: [],
  not_phrase: [],
};

/**
 * Splits parsed query terms into the keyword part (matched against attachment
 * content) and the filter part (everything else, applied to the parent page),
 * so an operator added to QueryTerms later lands on the page side by default.
 */
export const splitQueryTerms = (
  terms: QueryTerms,
): { keywords: AttachmentKeywordTerms; filters: PageFilterTerms } => {
  const { match, not_match, phrase, not_phrase, ...filters } = terms;
  return { keywords: { match, not_match, phrase, not_phrase }, filters };
};

/** Whether the keyword part can match anything on its own. */
export const hasPositiveKeyword = (keywords: AttachmentKeywordTerms): boolean =>
  keywords.match.length > 0 || keywords.phrase.length > 0;
