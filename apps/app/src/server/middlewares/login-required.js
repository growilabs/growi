import { createRedirectToForUnauthenticated } from '~/server/util/createRedirectToForUnauthenticated';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:login-required');

/**
 * require login handler
 * @param {import('~/server/crowi').default} crowi Crowi instance
 * @param {boolean} isGuestAllowed whether guest user is allowed (default false)
 * @param {function} fallback fallback function which will be triggered when the check cannot be passed
 */
module.exports = (crowi, isGuestAllowed = false, fallback = null) => {
  return (req, res, next) => {
    const User = crowi.model('User');

    // check the user logged in
    if (req.user != null && req.user instanceof Object && '_id' in req.user) {
      if (req.user.status === User.STATUS_ACTIVE) {
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
    req.session.redirectTo = req.originalUrl;
    return res.redirect('/login');
  };
};
