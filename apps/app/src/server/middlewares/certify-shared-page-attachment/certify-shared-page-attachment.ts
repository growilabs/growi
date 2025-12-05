import type { NextFunction, Request, Response } from 'express';

import loggerFactory from '~/utils/logger';

import { retrieveValidShareLinkByReferer } from './retrieve-valid-share-link';
import { validateAttachment } from './validate-attachment';
import { validateReferer } from './validate-referer';

const logger = loggerFactory('growi:middleware:certify-shared-page-attachment');

export interface RequestToAllowShareLink extends Request {
  isSharedPage?: boolean;
}

export const certifySharedPageAttachmentMiddleware = async (
  req: RequestToAllowShareLink,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const fileId: string | undefined = req.params.id;
  const { referer } = req.headers;

  if (fileId == null) {
    logger.error(
      'The param fileId is required. Please confirm to usage of this middleware.',
    );
    return next();
  }

  const validReferer = validateReferer(referer);
  if (!validReferer) {
    return next();
  }

  const shareLink = await retrieveValidShareLinkByReferer(validReferer);
  if (shareLink == null) {
    logger.warn(
      `No valid ShareLink document found by the referer (${validReferer.referer}})`,
    );
    return next();
  }

  if (!(await validateAttachment(fileId, shareLink))) {
    logger.warn(
      `No valid ShareLink document found by the fileId (${fileId}) and referer (${validReferer.referer}})`,
    );
    return next();
  }

  req.isSharedPage = true;
  next();
};
