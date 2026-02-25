/**
 * Redirect with prevention from Open Redirect
 *
 * Usage: app.use(require('middlewares/safe-redirect')(['example.com', 'some.example.com:8080']))
 */

import type { NextFunction, Request, Response } from 'express';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:safe-redirect');

/**
 * Check whether the redirect url host is in specified whitelist
 */
function isInWhitelist(
  whitelistOfHosts: string[],
  redirectToFqdn: string,
): boolean {
  if (whitelistOfHosts == null || whitelistOfHosts.length === 0) {
    return false;
  }

  try {
    const redirectUrl = new URL(redirectToFqdn);
    return (
      whitelistOfHosts.includes(redirectUrl.hostname) ||
      whitelistOfHosts.includes(redirectUrl.host)
    );
  } catch (err) {
    logger.warn(err);
    return false;
  }
}

export type ResWithSafeRedirect = Response & {
  safeRedirect: (redirectTo?: string) => void;
};

const factory = (whitelistOfHosts: string[]) => {
  return (req: Request, res: ResWithSafeRedirect, next: NextFunction): void => {
    // extend res object
    res.safeRedirect = (redirectTo?: string) => {
      if (redirectTo == null) {
        return res.redirect('/');
      }

      try {
        // check inner redirect
        const redirectUrl = new URL(
          redirectTo,
          `${req.protocol}://${req.get('host')}`,
        );
        if (redirectUrl.hostname === req.hostname) {
          logger.debug(`Requested redirect URL (${redirectTo}) is local.`);
          return res.redirect(redirectUrl.href);
        }
        logger.debug(`Requested redirect URL (${redirectTo}) is NOT local.`);

        // check whitelisted redirect
        const isWhitelisted = isInWhitelist(whitelistOfHosts, redirectTo);
        if (isWhitelisted) {
          logger.debug(
            `Requested redirect URL (${redirectTo}) is in whitelist.`,
            `whitelist=${whitelistOfHosts}`,
          );
          return res.redirect(redirectTo);
        }
        logger.debug(
          `Requested redirect URL (${redirectTo}) is NOT in whitelist.`,
          `whitelist=${whitelistOfHosts}`,
        );
      } catch (err) {
        logger.warn(`Requested redirect URL (${redirectTo}) is invalid.`, err);
      }

      logger.warn(
        `Requested redirect URL (${redirectTo}) is UNSAFE, redirecting to root page.`,
      );
      return res.redirect('/');
    };

    next();
  };
};

export default factory;
