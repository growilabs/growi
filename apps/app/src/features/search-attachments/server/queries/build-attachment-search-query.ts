/**
 * Pure function that builds a content-only search query body for the attachments index.
 * No permission filter is applied here — permission checks happen at query-time
 * via the page index lookup in the aggregator layer.
 */

const DEFAULT_SIZE = 20;
const DEFAULT_FROM = 0;

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

export type BuildAttachmentSearchQueryOptions = {
  highlight?: boolean;
  size?: number;
  from?: number;
};

/**
 * Build an Elasticsearch request body for a full-text search against the attachments index.
 *
 * @param keyword - The search keyword string
 * @param options - Optional: highlight, size, from
 * @returns A full ES request body (query, highlight, size, from)
 */
export function buildAttachmentSearchQuery(
  keyword: string,
  options: BuildAttachmentSearchQueryOptions = {},
): Record<string, unknown> {
  const {
    highlight = false,
    size = DEFAULT_SIZE,
    from = DEFAULT_FROM,
  } = options;

  const body: Record<string, unknown> = {
    query: {
      bool: {
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
    from,
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
