/**
 * Pure function that builds a content-only search query body for the attachments index.
 * No permission filter is applied here — permission checks happen at query-time
 * via the page index lookup in the aggregator layer.
 */

import {
  buildAttachmentHighlight,
  buildAttachmentKeywordClauses,
} from './attachment-keyword-query';
import type { AttachmentKeywordTerms } from './split-query-terms';

const DEFAULT_SIZE = 20;
const DEFAULT_FROM = 0;

export type BuildAttachmentSearchQueryOptions = {
  highlight?: boolean;
  size?: number;
  from?: number;
};

/**
 * Build an Elasticsearch request body for a full-text search against the attachments index.
 * The hit count is not tracked: it counts hits before the permission check.
 *
 * @param keywords - The keyword part of the parsed query (operators excluded)
 * @param options - Optional: highlight, size, from
 * @returns A full ES request body (query, highlight, size, from)
 */
export function buildAttachmentSearchQuery(
  keywords: AttachmentKeywordTerms,
  options: BuildAttachmentSearchQueryOptions = {},
): Record<string, unknown> {
  const {
    highlight = false,
    size = DEFAULT_SIZE,
    from = DEFAULT_FROM,
  } = options;

  const body: Record<string, unknown> = {
    query: { bool: buildAttachmentKeywordClauses(keywords) },
    size,
    from,
    track_total_hits: false,
  };

  if (highlight) {
    body.highlight = buildAttachmentHighlight();
  }

  return body;
}
