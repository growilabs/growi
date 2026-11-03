/**
 * Pure function for secondary enrichment: builds a search query body that
 * filters attachments by a set of page IDs and matches the keyword terms.
 *
 * Used in the secondary enrichment phase after permission-filtered page IDs
 * have been resolved from the page index.
 */

import {
  buildAttachmentHighlight,
  buildAttachmentKeywordClauses,
} from './attachment-keyword-query';
import type { AttachmentKeywordTerms } from './split-query-terms';

export const DEFAULT_PAGE_SIZE = 20;

export type BuildAttachmentsByPageIdsQueryOptions = {
  size?: number;
  highlight?: boolean;
};

/**
 * Build an Elasticsearch request body that filters attachments by page IDs
 * and matches the keyword terms against their content.
 *
 * @param keywords - The keyword part of the parsed query (operators excluded)
 * @param pageIds - Array of page IDs to restrict the search to
 * @param options - Optional: size, highlight
 * @throws {RangeError} When pageIds.length exceeds DEFAULT_PAGE_SIZE (to prevent massive terms queries)
 * @returns A full ES request body
 */
export function buildAttachmentsByPageIdsQuery(
  keywords: AttachmentKeywordTerms,
  pageIds: string[],
  options: BuildAttachmentsByPageIdsQueryOptions = {},
): Record<string, unknown> {
  if (pageIds.length > DEFAULT_PAGE_SIZE) {
    throw new RangeError(
      `pageIds.length (${pageIds.length}) exceeds the maximum allowed page size (${DEFAULT_PAGE_SIZE}). ` +
        'Split the request into smaller batches to avoid excessive terms queries.',
    );
  }

  const { size = DEFAULT_PAGE_SIZE, highlight = false } = options;

  const body: Record<string, unknown> = {
    query: {
      bool: {
        filter: [{ terms: { pageId: pageIds } }],
        ...buildAttachmentKeywordClauses(keywords),
      },
    },
    size,
    track_total_hits: false,
  };

  if (highlight) {
    body.highlight = buildAttachmentHighlight();
  }

  return body;
}
