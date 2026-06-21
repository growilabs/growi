import type { IUser } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';

const logger = loggerFactory('growi:middleware:admin-required');

type RequestWithUser = Request & { user?: HydratedDocument<IUser> };

type FallbackFunction = (
  req: RequestWithUser,
  res: Response,
  next: NextFunction,
) => void;

const adminRequiredFactory = (
  _crowi: Crowi,
  fallback: FallbackFunction | null = null,
) => {
  return (req: RequestWithUser, res: Response, next: NextFunction) => {
    if (req.user != null && req.user instanceof Object && '_id' in req.user) {
      if (req.user.admin) {
        return next();
      }

      logger.warn('This user is not admin.');

      if (fallback != null) {
        return fallback(req, res, next);
      }
      return res.redirect('/');
    }

    logger.warn('This user has not logged in.');

    if (fallback != null) {
      return fallback(req, res, next);
    }
    return res.redirect('/login');
  };
};

export default adminRequiredFactory;
