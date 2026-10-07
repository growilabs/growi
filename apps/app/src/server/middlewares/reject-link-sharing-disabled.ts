import { ErrorV3 } from '@growi/core/dist/models';
import type { RequestHandler } from 'express';

import { configManager } from '~/server/service/config-manager';

import type { ApiV3Response } from '../routes/apiv3/interfaces/apiv3-response';

/**
 * Middleware that rejects requests when link sharing is globally disabled.
 * Place before certifySharedPage to skip unnecessary DB access.
 */
export const rejectLinkSharingDisabled: RequestHandler = (
  _req,
  res: ApiV3Response,
  next,
) => {
  const disableLinkSharing = configManager.getConfig(
    'security:disableLinkSharing',
  );
  if (disableLinkSharing) {
    return res.apiv3Err(
      new ErrorV3('Link sharing is disabled', 'link-sharing-disabled'),
      403,
    );
  }
  return next();
};
