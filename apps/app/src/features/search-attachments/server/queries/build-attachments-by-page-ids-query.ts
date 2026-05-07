/**
 * Pure function for secondary enrichment: builds a search query body that
 * filters attachments by a set of page IDs and matches a keyword.
 *
 * Used in the secondary enrichment phase after permission-filtered page IDs
 * have been resolved from the page index.
 */

export const DEFAULT_PAGE_SIZE = 20;

/**
 * Fields to search in the attachments index.
 * Includes multi-language sub-fields for content and name fields.
 */
const ATTACHMENT_SEARCH_FIELDS = [
  'content',
  'content.ja',
  'content.en',
  'fileName',
  'originalName',
];

export type BuildAttachmentsByPageIdsQueryOptions = {
  size?: number;
  highlight?: boolean;
};

/**
 * Build an Elasticsearch request body that filters attachments by page IDs
 * and performs a content match on the keyword.
 *
 * @param keyword - The search keyword string
 * @param pageIds - Array of page IDs to restrict the search to
 * @param options - Optional: size, highlight
 * @throws {RangeError} When pageIds.length exceeds DEFAULT_PAGE_SIZE (to prevent massive terms queries)
 * @returns A full ES request body
 */
export function buildAttachmentsByPageIdsQuery(
  keyword: string,
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
        filter: [
          {
            terms: {
              pageId: pageIds,
            },
          },
        ],
        must: [
          {
            multi_match: {
              query: keyword,
              type: 'most_fields',
              fields: ATTACHMENT_SEARCH_FIELDS,
            },
          },
        ],
      },
    },
    size,
  };

  if (highlight) {
    body.highlight = {
      fragmenter: 'simple',
      pre_tags: ["<em class='highlighted-keyword'>"],
      post_tags: ['</em>'],
      fields: {
        content: {
          fragment_size: 40,
        },
        'content.ja': {
          fragment_size: 40,
        },
        'content.en': {
          fragment_size: 40,
        },
        fileName: {
          fragment_size: 80,
        },
        originalName: {
          fragment_size: 80,
        },
      },
      max_analyzed_offset: 1000000 - 1,
    };
  }

  return body;
}
