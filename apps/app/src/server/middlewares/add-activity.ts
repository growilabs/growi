import type { IUserHasId } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middlewares:add-activity');

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

export const generateAddActivityMiddleware =
  () =>
  async (
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (req.method === 'GET') {
      logger.warn('This middleware is not available for GET requests');
      return next();
    }

    const parameter = {
      ip: req.ip,
      endpoint: req.originalUrl,
      action: SupportedAction.ACTION_UNSETTLED,
      user: req.user?._id,
      snapshot: {
        username: req.user?.username,
      },
    };

    try {
      const activity = await Activity.createByParameters(parameter);
      res.locals.activity = activity;
    } catch (err) {
      logger.error('Create activity failed', err);
    }

    return next();
  };
