import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Response } from 'express';

import loggerFactory from '../../utils/logger';
import { configManager } from '../service/config-manager';
import isSimpleRequest from '../util/is-simple-request';
import type { AccessTokenParserReq } from './access-token-parser/interfaces';

const logger = loggerFactory('growi:middleware:certify-origin');

type Apiv3ErrFunction = (error: ErrorV3) => void;

const certifyOrigin = (
  req: AccessTokenParserReq,
  res: Response & { apiv3Err: Apiv3ErrFunction },
  next: NextFunction,
): void => {
  const appSiteUrl = configManager.getConfig('app:siteUrl');
  const configuredOrigin = appSiteUrl ? new URL(appSiteUrl).origin : null;
  const requestOrigin = req.headers.origin;
  const runtimeOrigin = `${req.protocol}://${req.get('host')}`;

  const isSameOriginReq =
    requestOrigin == null ||
    requestOrigin === configuredOrigin ||
    requestOrigin === runtimeOrigin;

  const accessToken = req.query.access_token ?? req.body.access_token;

  if (!isSameOriginReq && req.headers.origin != null && isSimpleRequest(req)) {
    const message = 'Invalid request (origin check failed but simple request)';
    logger.error(message);
    res.apiv3Err(new ErrorV3(message));
    return;
  }

  if (!isSameOriginReq && accessToken == null && !isSimpleRequest(req)) {
    const message = 'Invalid request (origin check failed and no access token)';
    logger.error(message);
    res.apiv3Err(new ErrorV3(message));
    return;
  }

  next();
};
export default certifyOrigin;
