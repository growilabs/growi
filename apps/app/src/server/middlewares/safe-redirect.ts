/**
 * Redirect with prevention from Open Redirect
 *
 * Usage: app.use(require('middlewares/safe-redirect')(['example.com', 'some.example.com:8080']))
 */

import type { NextFunction, Request, Response } from 'express';

import loggerFactory from '~/utils/logger';

import { configManager } from '../service/config-manager';
import {
  resolveSafeRedirect,
  type SafeRedirectContext,
} from './safe-redirect-target';

const logger = loggerFactory('growi:middleware:safe-redirect');

export type ResWithSafeRedirect = Response & {
  safeRedirect: (redirectTo?: string) => void;
};

/**
 * app:siteUrl is preferred when building the redirect target so the emitted URL keeps
 * the correct scheme/host/port behind a TLS-terminating reverse proxy (where
 * req.protocol would be http). configManager throws until the config store is loaded
 * (very early boot); fall back to undefined — the request-derived origin — in that
 * window. See issue #11248.
 */
const getConfiguredSiteUrl = (): string | undefined => {
  try {
    return configManager.getConfig('app:siteUrl');
  } catch {
    return undefined;
  }
};

const factory = (whitelistOfHosts: string[]) => {
  return (req: Request, res: ResWithSafeRedirect, next: NextFunction): void => {
    // extend res object
    res.safeRedirect = (redirectTo?: string) => {
      const ctx: SafeRedirectContext = {
        reqProtocol: req.protocol,
        reqHost: req.get('host') ?? '',
        reqHostname: req.hostname,
        appSiteUrl: getConfiguredSiteUrl(),
        whitelistOfHosts,
      };
      const { target, disposition } = resolveSafeRedirect(redirectTo, ctx);

      if (disposition === 'blocked' || disposition === 'invalid') {
        logger.warn(
          `Requested redirect URL (${redirectTo}) is unsafe (${disposition}), redirecting to root page.`,
        );
      } else {
        logger.debug(
          `Redirecting (${disposition}): ${redirectTo} -> ${target}`,
        );
      }

      return res.redirect(target);
    };

    next();
  };
};

export default factory;
