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
  return (req: RequestWithUser, res: Response, next: NextFunction) => {
    // check the user logged in
    if (req.user != null && req.user instanceof Object && '_id' in req.user) {
      if (req.user.status === UserStatus.STATUS_ACTIVE) {
        // Active の人だけ先に進める
        return next();
      }

      const redirectTo =
        createRedirectToForUnauthenticated(req.user.status) ?? '/login';
      return res.redirect(redirectTo);
    }

    // check the route config and ACL
    if (isGuestAllowed && crowi.aclService.isGuestAllowedToRead()) {
      logger.debug('Allowed to read: ', req.path);
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
