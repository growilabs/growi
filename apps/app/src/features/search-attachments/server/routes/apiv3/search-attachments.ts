/**
 * GET /_api/v3/search/attachments
 *
 * Secondary enrichment endpoint: resolves attachment hits for a set of
 * page IDs that have already been returned by the primary page search.
 *
 * Query params:
 *   q        — keyword (optional; empty string is accepted)
 *   pageIds  — comma-separated page IDs (required, 1–20 elements)
 *
 * Error responses:
 *   400  — pageIds missing, empty, or exceeds 20 elements
 *   503  — feature disabled (injected by requireSearchAttachmentsEnabled middleware)
 */

import express from 'express';

import type { AttachmentSearchResultAggregator } from '~/features/search-attachments/server/services/attachment-search-result-aggregator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:features:search-attachments:routes:apiv3:search-attachments',
);

/** Maximum number of pageIds accepted per request. */
const MAX_PAGE_IDS = 20;

/**
 * Parses the `pageIds` query parameter.
 *
 * Supports two forms:
 *  - Comma-separated string:  `?pageIds=id1,id2,id3`
 *  - Array (single value):   `?pageIds=id1` (still becomes a string)
 *
 * Returns an empty array when the param is absent or the resulting list
 * is empty after splitting and filtering blank segments.
 */
function parsePageIds(raw: unknown): string[] {
  if (raw == null || raw === '') {
    return [];
  }

  // Express may deliver a string or an array of strings
  const joined = Array.isArray(raw) ? raw.join(',') : String(raw);

  return joined
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Creates an Express router for the search-attachments secondary enrichment
 * endpoint.
 *
 * @param aggregator                — AttachmentSearchResultAggregator instance
 * @param isSearchServiceConfigured — returns true when Elasticsearch is configured
 */
export function createSearchAttachmentsRouter(
  aggregator: AttachmentSearchResultAggregator,
  _isSearchServiceConfigured: () => boolean,
): express.Router {
  const router = express.Router();

  /**
   * GET /
   *
   * Delegates to AttachmentSearchResultAggregator.resolveSecondary and
   * returns enrichment data keyed by pageId.
   */
  router.get('/', async (req, res: ApiV3Response) => {
    const q = String(req.query.q ?? '');

    const pageIds = parsePageIds(req.query.pageIds);

    // Validate: pageIds must be present and non-empty
    if (pageIds.length === 0) {
      return res.status(400).json({
        errors: [
          {
            message:
              'pageIds query parameter is required and must not be empty',
            code: 'invalid_page_ids',
          },
        ],
      });
    }

    // Validate: pageIds must not exceed the maximum allowed
    if (pageIds.length > MAX_PAGE_IDS) {
      return res.status(400).json({
        errors: [
          {
            message: `pageIds must not exceed ${MAX_PAGE_IDS} elements (received ${pageIds.length})`,
            code: 'too_many_page_ids',
          },
        ],
      });
    }

    try {
      const result = await aggregator.resolveSecondary(q, {
        facet: 'all',
        primaryIds: pageIds,
      });

      return res.apiv3(result);
    } catch (err) {
      logger.error(
        { err, q, pageIdCount: pageIds.length },
        'resolveSecondary failed',
      );
      return res.status(500).json({
        errors: [{ message: 'Internal server error during attachment search' }],
      });
    }
  });

  return router;
}
