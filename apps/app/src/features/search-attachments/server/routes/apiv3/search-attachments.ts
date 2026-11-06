/**
 * GET /_api/v3/search/attachments
 *
 * Secondary enrichment endpoint: resolves attachment hits for a set of
 * page IDs that have already been returned by the primary page search.
 *
 * Query params:
 *   q        — keyword (optional; empty string is accepted)
 *   pageIds  — page IDs, comma-separated and/or repeated (1–20 distinct ObjectIds)
 *
 * Middleware chain (same reader rule as `GET /_api/search`):
 *   accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true })
 *   + guest-allowed loginRequired (guests only when `isGuestAllowedToRead`)
 *   + requireSearchAttachmentsEnabled
 *
 * The ids come from the client, so each one is re-checked against the
 * requesting user (guest when not logged in) and the query's operators; ids
 * the user cannot read, that the query excludes, or that do not exist produce
 * no enrichment.
 *
 * Error responses (fixed messages, the input is never echoed):
 *   400  — invalid_query / invalid_page_ids
 *   403  — not logged in and guests may not read
 *   503  — feature_disabled
 */

import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { isValidObjectId } from '@growi/core/dist/utils/objectid-utils';
import express from 'express';

import type { AttachmentSearchViewer } from '~/features/search-attachments/server/services/search-accessible-pages';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { createRequireSearchAttachmentsEnabled } from '../../middlewares/require-search-attachments-enabled';
import { DEFAULT_PAGE_SIZE as MAX_PAGE_IDS } from '../../queries';
import { resolveAttachmentSearchViewer } from '../../services/resolve-attachment-search-viewer';

const logger = loggerFactory(
  'growi:features:search-attachments:routes:apiv3:search-attachments',
);

type ParsedQuery =
  | { ok: true; q: string; pageIds: string[] }
  | { ok: false; code: string; message: string };

const invalidPageIds = (message: string): ParsedQuery => ({
  ok: false,
  code: 'invalid_page_ids',
  message,
});

/**
 * Accepts `q` as one string, and `pageIds` as one string or repeated strings,
 * each holding comma-separated ObjectIds. Any other shape (objects from
 * `pageIds[$ne]=`, nested arrays) is rejected rather than coerced.
 */
function parseQuery(query: express.Request['query']): ParsedQuery {
  const { q = '', pageIds: rawPageIds } = query;
  if (typeof q !== 'string') {
    return {
      ok: false,
      code: 'invalid_query',
      message: 'q must be a single string',
    };
  }

  const parts = Array.isArray(rawPageIds) ? rawPageIds : [rawPageIds ?? ''];
  if (!parts.every((part) => typeof part === 'string')) {
    return invalidPageIds('pageIds must be a list of page ids');
  }

  const ids = [
    ...new Set(
      parts
        .flatMap((part) => part.split(','))
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];
  if (ids.length === 0) {
    return invalidPageIds(
      'pageIds query parameter is required and must not be empty',
    );
  }
  if (ids.length > MAX_PAGE_IDS) {
    return invalidPageIds(
      `pageIds must not exceed ${MAX_PAGE_IDS} distinct elements`,
    );
  }
  if (!ids.every((id) => isValidObjectId(id))) {
    return invalidPageIds('pageIds must be a list of page ids');
  }
  return { ok: true, q, pageIds: ids };
}

/**
 * @param crowi         — supplies the search service and the guest-read setting, read per request
 * @param resolveViewer — resolves the requesting user and their groups
 */
export function createSearchAttachmentsRouter(
  crowi: Crowi,
  resolveViewer: (
    user: IUserHasId | null | undefined,
  ) => Promise<AttachmentSearchViewer> = resolveAttachmentSearchViewer,
): express.Router {
  const router = express.Router();

  const loginRequired = loginRequiredFactory(crowi, true);
  const requireSearchAttachmentsEnabled = createRequireSearchAttachmentsEnabled(
    () => crowi.searchService?.isConfigured === true,
  );

  router.get(
    '/',
    accessTokenParser([SCOPE.READ.FEATURES.PAGE], { acceptLegacy: true }),
    loginRequired,
    requireSearchAttachmentsEnabled,
    async (
      req: express.Request & { user?: IUserHasId },
      res: ApiV3Response,
    ) => {
      const parsed = parseQuery(req.query);
      if (!parsed.ok) {
        return res.status(400).json({
          errors: [{ message: parsed.message, code: parsed.code }],
        });
      }
      const { q, pageIds } = parsed;

      try {
        const viewer = await resolveViewer(req.user);
        const result = await crowi.searchService.resolveAttachmentSecondary(
          q,
          viewer,
          { primaryIds: pageIds },
        );

        return res.apiv3(result);
      } catch (err) {
        logger.error(
          { err, pageIdCount: pageIds.length },
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
