import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:search-attachments:middleware');

/**
 * Creates middleware that returns 503 feature_disabled when attachment full-text search is not configured.
 *
 * isAttachmentFullTextSearchEnabled =
 *   isSearchServiceConfigured() &&
 *   extractorUri != null && extractorUri !== '' &&
 *   extractorToken != null && extractorToken !== ''
 */
export function createRequireSearchAttachmentsEnabled(
  isSearchServiceConfigured: () => boolean,
): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    const extractorUri = configManager.getConfig(
      'app:attachmentFullTextSearch:extractorUri',
    );
    const extractorToken = configManager.getConfig(
      'app:attachmentFullTextSearch:extractorToken',
    );

    const isEnabled =
      isSearchServiceConfigured() &&
      extractorUri != null &&
      extractorUri !== '' &&
      extractorToken != null &&
      extractorToken !== '';

    if (!isEnabled) {
      logger.warn(
        'Attachment full-text search feature is disabled: ' +
          `searchConfigured=${isSearchServiceConfigured()}, ` +
          `extractorUri=${extractorUri != null ? '"set"' : 'null'}, ` +
          `extractorToken=${extractorToken != null ? '"set"' : 'null'}`,
      );
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
