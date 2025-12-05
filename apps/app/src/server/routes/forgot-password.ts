import type { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';

import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import loggerFactory from '~/utils/logger';

import type { IPasswordResetOrder } from '../models/password-reset-order';

const logger = loggerFactory('growi:routes:forgot-password');

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any
export const checkForgotPasswordEnabledMiddlewareFactory = (
  crowi: any,
  forApi = false,
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const isPasswordResetEnabled = crowi.configManager.getConfig(
      'security:passport-local:isPasswordResetEnabled',
    );
    const isLocalStrategySetup =
      (crowi.passportService.isLocalStrategySetup as boolean) ?? false;

    const isEnabled = isLocalStrategySetup && isPasswordResetEnabled;

    if (!isEnabled) {
      const message =
        'Forgot-password function is unavailable because neither LocalStrategy and LdapStrategy is not setup.';
      logger.error(message);

      const statusCode = forApi ? 405 : 404;
      next(
        createError(statusCode, message, {
          code: forgotPasswordErrorCode.PASSWORD_RESET_IS_UNAVAILABLE,
        }),
      );
      return;
    }

    next();
  };
};

type Crowi = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  nextApp: any;
};

type CrowiReq = Request & {
  crowi: Crowi;
};

export const renderForgotPassword = (crowi: Crowi) => {
  return (req: CrowiReq, res: Response, next: NextFunction): void => {
    const { nextApp } = crowi;
    req.crowi = crowi;
    nextApp.render(req, res, '/forgot-password');
    return;
  };
};

export const renderResetPassword = (crowi: Crowi) => {
  return (
    req: CrowiReq & { passwordResetOrder: IPasswordResetOrder },
    res: Response,
    next: NextFunction,
  ): void => {
    const { nextApp } = crowi;
    req.crowi = crowi;
    nextApp.render(req, res, '/reset-password', {
      email: req.passwordResetOrder.email,
    });
    return;
  };
};

// middleware to handle error
export const handleErrorsMiddleware = (crowi: Crowi) => {
  return (
    error: Error & { code: string; statusCode: number },
    req: CrowiReq,
    res: Response,
    next: NextFunction,
  ): void => {
    if (error != null) {
      const { nextApp } = crowi;

      req.crowi = crowi;
      res.status(error.statusCode);

      nextApp.render(req, res, '/forgot-password-errors', {
        errorCode: error.code,
      });
      return;
    }

    next();
  };
};
