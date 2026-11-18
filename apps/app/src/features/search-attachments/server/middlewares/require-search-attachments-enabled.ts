import type { NextFunction, Request, RequestHandler, Response } from 'express';

import loggerFactory from '~/utils/logger';

import { isAttachmentFullTextSearchEnabled } from '../services/is-attachment-full-text-search-enabled';

const logger = loggerFactory('growi:features:search-attachments:middleware');

/**
 * Creates middleware that returns 503 feature_disabled when attachment
 * full-text search is not enabled (see isAttachmentFullTextSearchEnabled).
 *
 * It does not authenticate: mount it after the route's auth chain.
 */
export function createRequireSearchAttachmentsEnabled(
  isSearchServiceConfigured: () => boolean,
): RequestHandler {
  // Named so the route-middleware snapshot tool can identify it.
  return function requireSearchAttachmentsEnabled(
    _req: Request,
    res: Response,
    next: NextFunction,
  ) {
    if (!isAttachmentFullTextSearchEnabled(isSearchServiceConfigured())) {
      logger.debug('Attachment full-text search feature is disabled');
      return res.status(503).json({
        errors: [
          {
            message: 'Attachment full-text search feature is disabled',
            code: 'feature_disabled',
          },
        ],
      });
    }

    return next();
  };
}
