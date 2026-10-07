import type { Request, Response } from 'express';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:deny-uploads-direct-access');

/**
 * Deny direct access to uploaded files stored under `publicDir/uploads/**`.
 *
 * When the upload method is "Local", attachments are written under
 * `publicDir/uploads/**`, which would otherwise be served directly by
 * `express.static(publicDir)`. Serving them statically bypasses the
 * `/attachment` and `/download` routes that apply authorization,
 * `Content-Disposition` and `Content-Security-Policy` headers, enabling stored
 * XSS and access-control bypass.
 *
 * This middleware blanket-denies the whole `/uploads` prefix (attachment, user,
 * page-bulk-export, audit-log-bulk-export and any future subdirectory) so that
 * adding a new storage prefix never silently re-opens the hole. It MUST be
 * registered BEFORE `express.static(publicDir)`.
 */
export const denyUploadsDirectAccess = (req: Request, res: Response): void => {
  logger.debug(`Blocked direct access to an uploaded file: ${req.originalUrl}`);
  res.status(403).send('Forbidden');
};
