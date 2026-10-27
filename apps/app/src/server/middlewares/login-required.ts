import type { IUser } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';

import { createRedirectToForUnauthenticated } from '~/server/util/createRedirectToForUnauthenticated';
import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { UserStatus } from '../models/user/conts';

const logger = loggerFactory('growi:middleware:login-required');

type RequestWithUser = Request & {
  user?: HydratedDocument<IUser>;
  isSharedPage?: boolean;
  isBrandLogo?: boolean;
  session?: { redirectTo?: string };
};

type FallbackFunction = (
  req: RequestWithUser,
  res: Response,
  next: NextFunction,
) => void;

/**
 * Whether a logged-in user may pass loginRequired. Also used by paths that
 * cannot run the middleware itself (e.g. the Yjs WebSocket upgrade).
 */
export const isActiveUser = (user: Pick<IUser, 'status'>): boolean =>
  user.status === UserStatus.STATUS_ACTIVE;

/**
 * require login handler
 * @param crowi Crowi instance
 * @param isGuestAllowed whether guest user is allowed (default false)
 * @param fallback fallback function which will be triggered when the check cannot be passed
 */
const loginRequiredFactory = (
  crowi: Crowi,
  isGuestAllowed = false,
  fallback: FallbackFunction | null = null,
) => {
  // Named function (not an arrow) so the snapshot tool can identify this
  // middleware by name when walking `app._router.stack`.
  return function loginRequired(
    req: RequestWithUser,
    res: Response,
    next: NextFunction,
  ) {
    // check the user logged in
    if (req.user != null && req.user instanceof Object && '_id' in req.user) {
      if (isActiveUser(req.user)) {
        // Active の人だけ先に進める
        return next();
      }

      const redirectTo =
        createRedirectToForUnauthenticated(req.user.status) ?? '/login';
      return res.redirect(redirectTo);
    }

    // check the route config and ACL
    if (isGuestAllowed && crowi.aclService.isGuestAllowedToRead()) {
      logger.debug({ path: req.path }, 'Allowed to read');
      return next();
    }

    // check the page is shared
    if (isGuestAllowed && req.isSharedPage) {
      logger.debug('Target page is shared page');
      return next();
    }

    // Check if it is a Brand logo
    if (req.isBrandLogo) {
      logger.debug('Target is Brand logo');
      return next();
    }

    // is api path
    const baseUrl = req.baseUrl || '';
    if (baseUrl.match(/^\/_api\/.+$/)) {
      if (fallback != null) {
        return fallback(req, res, next);
      }
      return res.sendStatus(403);
    }

    if (fallback != null) {
      return fallback(req, res, next);
    }
    if (req.session != null) {
      req.session.redirectTo = req.originalUrl;
    }
    return res.redirect('/login');
  };
};

export default loginRequiredFactory;
