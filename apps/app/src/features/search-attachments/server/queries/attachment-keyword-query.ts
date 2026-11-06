import type { AttachmentKeywordTerms } from './split-query-terms';

/**
 * Highlight markers: buildSnippetSegments() parses exactly these, so the ES
 * request and the parser must share them.
 */
export const ATTACHMENT_HIGHLIGHT_PRE_TAG = '<em>';
export const ATTACHMENT_HIGHLIGHT_POST_TAG = '</em>';

const ATTACHMENT_SEARCH_FIELDS = [
  'content',
  'content.ja',
  'content.en',
  'fileName',
  'originalName',
];

// Not analyzed per language, like page search's phrase fields.
const ATTACHMENT_PHRASE_FIELDS = ['content', 'fileName', 'originalName'];

/**
 * The bool clauses that match attachment content against the keyword terms,
 * mirroring how page search's appendCriteriaForQueryString treats each kind.
 */
export const buildAttachmentKeywordClauses = (
  keywords: AttachmentKeywordTerms,
): { must: Record<string, unknown>[]; must_not: Record<string, unknown>[] } => {
  const must: Record<string, unknown>[] = [];
  const mustNot: Record<string, unknown>[] = [];

  if (keywords.match.length > 0) {
    must.push({
      multi_match: {
        query: keywords.match.join(' '),
        type: 'most_fields',
        fields: ATTACHMENT_SEARCH_FIELDS,
      },
    });
  }
  if (keywords.not_match.length > 0) {
    mustNot.push({
      multi_match: {
        query: keywords.not_match.join(' '),
        fields: ATTACHMENT_SEARCH_FIELDS,
        operator: 'or',
      },
    });
  }
  for (const phrase of keywords.phrase) {
    must.push({
      multi_match: {
        query: phrase,
        type: 'phrase',
        fields: ATTACHMENT_PHRASE_FIELDS,
      },
    });
  }
  for (const phrase of keywords.not_phrase) {
    mustNot.push({
      multi_match: {
        query: phrase,
        type: 'phrase',
        fields: ATTACHMENT_PHRASE_FIELDS,
      },
    });
  }

  return { must, must_not: mustNot };
};

export const buildAttachmentHighlight = (): Record<string, unknown> => ({
  fragmenter: 'simple',
  pre_tags: [ATTACHMENT_HIGHLIGHT_PRE_TAG],
  post_tags: [ATTACHMENT_HIGHLIGHT_POST_TAG],
  fields: {
    content: { fragment_size: 40 },
    'content.ja': { fragment_size: 40 },
    'content.en': { fragment_size: 40 },
    fileName: { fragment_size: 80 },
    originalName: { fragment_size: 80 },
  },
  max_analyzed_offset: 1000000 - 1,
});
