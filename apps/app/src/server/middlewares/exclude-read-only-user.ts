import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Response } from 'express';
import type { Request } from 'express-validator/src/base';

import loggerFactory from '~/utils/logger';

import { configManager } from '../service/config-manager';

const logger = loggerFactory('growi:middleware:exclude-read-only-user');

export const excludeReadOnlyUser = (
  req: Request,
  res: Response & { apiv3Err },
  next: NextFunction,
): void => {
  const user = req.user;

  if (user == null) {
    logger.warn('req.user is null');
    next();
    return;
  }

  if (user.readOnly) {
    const message = 'This user is read only user';
    logger.warn(message);

    res.apiv3Err(new ErrorV3(message, 'validation_failed'));
    return;
  }

  next();
};

export const excludeReadOnlyUserIfCommentNotAllowed = (
  req: Request,
  res: Response & { apiv3Err },
  next: NextFunction,
): void => {
  const user = req.user;

  const isRomUserAllowedToComment = configManager.getConfig(
    'security:isRomUserAllowedToComment',
  );

  if (user == null) {
    logger.warn('req.user is null');
    next();
    return;
  }

  if (user.readOnly && !isRomUserAllowedToComment) {
    const message = 'This user is read only user and comment is not allowed';
    logger.warn(message);

    res.apiv3Err(new ErrorV3(message, 'validation_failed'));
    return;
  }

  next();
};
