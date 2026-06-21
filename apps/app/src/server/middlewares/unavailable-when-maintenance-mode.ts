import type { NextFunction, Request, Response } from 'express';

import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';

const logger = loggerFactory(
  'growi:middlewares:unavailable-when-maintenance-mode',
);

type CrowiReq = Request & {
  crowi: Crowi;
};

type IMiddleware = (
  req: CrowiReq,
  res: Response,
  next: NextFunction,
) => Promise<void>;

export const generateUnavailableWhenMaintenanceModeMiddleware = (
  crowi: Crowi,
): IMiddleware => {
  return async (req, res, next) => {
    const isMaintenanceMode = crowi.appService.isMaintenanceMode();

    if (!isMaintenanceMode) {
      next();
      return;
    }

    const { nextApp } = crowi;
    req.crowi = crowi;
    nextApp.render(req, res, '/maintenance');
  };
};

export const generateUnavailableWhenMaintenanceModeMiddlewareForApi = (
  crowi: Crowi,
): IMiddleware => {
  return async (req, res, next) => {
    const isMaintenanceMode = crowi.appService.isMaintenanceMode();

    if (!isMaintenanceMode) {
      next();
      return;
    }

    res.status(503).json({ error: 'GROWI is under maintenance.' });
  };
};
