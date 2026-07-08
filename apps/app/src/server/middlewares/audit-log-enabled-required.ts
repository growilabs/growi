import type { NextFunction, Request } from 'express';

import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:audit-log-enabled-required');

const auditLogEnabledRequired = (
  _req: Request,
  res: ApiV3Response,
  next: NextFunction,
): void => {
  if (!configManager.getConfig('app:auditLogEnabled')) {
    const msg = 'AuditLog is not enabled';
    logger.error(msg);
    res.apiv3Err(msg, 405);
    return;
  }

  next();
};

export default auditLogEnabledRequired;
