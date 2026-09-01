import type { NextFunction, Request, Response } from 'express';

type Middleware = (req: Request, res: Response, next: NextFunction) => void;

/**
 * Build a middleware that enforces `adminRequired` only while the application is
 * already installed, and lets the request through untouched before installation
 * completes (the g2g-transfer receiver has to accept a transfer into a fresh,
 * not-yet-installed instance that has no admin account yet).
 *
 * `isInstalled` MUST be a thunk that reads the install state live, per request —
 * it must NOT be a boolean captured when this factory runs at server boot.
 * Capturing the value at boot was the root cause of the g2g-transfer auth-bypass:
 * an instance that finished installation but had not been restarted kept the
 * stale `false` and left `generate-key` unauthenticated. Reading it live closes
 * that window the moment installation completes.
 */
export const generateAdminRequiredIfInstalled = (
  isInstalled: () => boolean,
  adminRequired: Middleware,
): Middleware => {
  return (req, res, next) => {
    if (!isInstalled()) {
      next();
      return;
    }

    return adminRequired(req, res, next);
  };
};
