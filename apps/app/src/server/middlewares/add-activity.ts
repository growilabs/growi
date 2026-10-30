import type { IUserHasId } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';

import type { PendingActivityContext } from '~/server/service/activity/index';
import {
  beginActivity,
  registerFailsafeFinalizer,
} from '~/server/service/activity/index';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middlewares:add-activity');

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

export const generateAddActivityMiddleware = () =>
  // Named function so the route-middleware snapshot tool can identify this
  // handler in the apiv3 auth chain.
  function addActivity(
    req: AuthorizedRequest,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.method === 'GET') {
      logger.warn('This middleware is not available for GET requests');
      next();
      return;
    }

    // Build the request-time context ONCE, at arrival time (Issue 3: createdAt
    // must be the arrival time, not the later settle/finalizer time). `_id` is
    // typed as `string` (HasObjectId) but Mongoose can hand back an ObjectId at
    // runtime, so `.toString()` normalizes it to match PendingActivityContext
    // and what createByParameters later expects.
    const context: PendingActivityContext = {
      ip: req.ip,
      endpoint: req.originalUrl,
      userId: req.user?._id?.toString(),
      username: req.user?.username,
      createdAt: new Date(),
    };

    // This middleware no longer writes to the DB (pre-create removed). It
    // only mints the id, stashes the context, and wires the fail-safe
    // finalizer -- all of the failure-detection logic and `res` wiring lives
    // in registerFailsafeFinalizer, not here (requirement 4.1). Best-effort:
    // a failure here must not crash the request.
    try {
      const { activityId } = beginActivity(context);
      // Preserves the 37 downstream `emit('update', res.locals.activity._id)`
      // call sites and the one `getIdStringForRef(res.locals.activity)`
      // (update-page.ts) without touching them.
      res.locals.activity = { _id: activityId };
      registerFailsafeFinalizer(res, activityId, context);
    } catch (err) {
      logger.error('Failed to begin activity tracking', err);
    }

    next();
  };
