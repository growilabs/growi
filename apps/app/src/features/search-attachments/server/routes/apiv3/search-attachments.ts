/**
 * GET /_api/v3/search/attachments
 *
 * Secondary enrichment endpoint: resolves attachment hits for a set of
 * page IDs that have already been returned by the primary page search.
 *
 * Query params:
 *   q        — keyword (optional; empty string is accepted)
 *   pageIds  — comma-separated page IDs (required, 1–20 distinct elements)
 *
 * The ids come from the client, so each one is re-checked against the
 * requesting user (guest when not logged in) and the query's operators; ids
 * the user cannot read, that the query excludes, or that do not exist produce
 * no enrichment.
 *
 * Error responses:
 *   400  — pageIds missing, empty, or more than 20 distinct elements
 *   503  — feature disabled (injected by requireSearchAttachmentsEnabled middleware)
 */

import type { IUserHasId } from '@growi/core';
import express from 'express';

import type { AttachmentSearchViewer } from '~/features/search-attachments/server/services/search-accessible-pages';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import type SearchService from '~/server/service/search';
import loggerFactory from '~/utils/logger';

import { resolveAttachmentSearchViewer } from '../../services/resolve-attachment-search-viewer';

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

  const ids = joined
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return [...new Set(ids)];
}

/**
 * Creates an Express router for the search-attachments secondary enrichment
 * endpoint.
 *
 * @param searchService             — parses the query and resolves the enrichment
 * @param isSearchServiceConfigured — returns true when Elasticsearch is configured
 * @param resolveViewer             — resolves the requesting user and their groups
 */
export function createSearchAttachmentsRouter(
  searchService: Pick<SearchService, 'resolveAttachmentSecondary'>,
  _isSearchServiceConfigured: () => boolean,
  resolveViewer: (
    user: IUserHasId | null | undefined,
  ) => Promise<AttachmentSearchViewer> = resolveAttachmentSearchViewer,
): express.Router {
  const router = express.Router();

  /**
   * GET /
   *
   * Delegates to SearchService.resolveAttachmentSecondary and
   * returns enrichment data keyed by pageId.
   */
  router.get(
    '/',
    async (
      req: express.Request & { user?: IUserHasId },
      res: ApiV3Response,
    ) => {
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
        const viewer = await resolveViewer(req.user);
        const result = await searchService.resolveAttachmentSecondary(
          q,
          viewer,
          { primaryIds: pageIds },
        );

        return res.apiv3(result);
      } catch (err) {
        logger.error(
          { err, q, pageIdCount: pageIds.length },
          'resolveSecondary failed',
        );
        return res.status(500).json({
          errors: [
            { message: 'Internal server error during attachment search' },
          ],
        });
      }
    },
  );

  return router;
}
