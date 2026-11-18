/**
 * Pure function for secondary enrichment: builds a search query body that
 * filters attachments by a set of page IDs and matches the keyword terms.
 *
 * Used in the secondary enrichment phase after permission-filtered page IDs
 * have been resolved from the page index.
 */

import {
  ATTACHMENT_HIT_SOURCE,
  buildAttachmentHighlight,
  buildAttachmentKeywordClauses,
} from './attachment-keyword-query';
import type { AttachmentKeywordTerms } from './split-query-terms';

export const DEFAULT_PAGE_SIZE = 20;

/**
 * Hits returned per page. The UI shows the best one and folds the rest, so a
 * few are enough; the bound keeps one long file from taking every slot.
 */
export const ATTACHMENT_HITS_PER_PAGE = 5;

/** The inner_hits name under which each page's hits come back. */
export const PAGE_HITS = 'pageHits';

/**
 * Build an Elasticsearch request body that filters attachments by page IDs
 * and matches the keyword terms against their content. Hits come back
 * grouped per page (one collapsed hit per page, its best hits under
 * `inner_hits[PAGE_HITS]`), so each page gets its own share.
 *
 * @param keywords - The keyword part of the parsed query (operators excluded)
 * @param pageIds - Array of page IDs to restrict the search to
 * @throws {RangeError} When pageIds.length exceeds DEFAULT_PAGE_SIZE (to prevent massive terms queries)
 * @returns A full ES request body
 */
export function buildAttachmentsByPageIdsQuery(
  keywords: AttachmentKeywordTerms,
  pageIds: string[],
): Record<string, unknown> {
  if (pageIds.length > DEFAULT_PAGE_SIZE) {
    throw new RangeError(
      `pageIds.length (${pageIds.length}) exceeds the maximum allowed page size (${DEFAULT_PAGE_SIZE}). ` +
        'Split the request into smaller batches to avoid excessive terms queries.',
    );
  }

  return {
    query: {
      bool: {
        filter: [{ terms: { pageId: pageIds } }],
        ...buildAttachmentKeywordClauses(keywords),
      },
    },
    collapse: {
      field: 'pageId',
      inner_hits: {
        name: PAGE_HITS,
        size: ATTACHMENT_HITS_PER_PAGE,
        _source: ATTACHMENT_HIT_SOURCE,
        highlight: buildAttachmentHighlight(),
      },
    },
    size: pageIds.length,
    track_total_hits: false,
    _source: false,
  };
}
