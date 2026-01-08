import type { NextFunction, Request, Response } from 'express';
import createError, { isHttpError } from 'http-errors';

import type Crowi from '../crowi';

/**
 * Middleware factory to check if the application is already installed
 */
export const generateCheckerMiddleware =
  (crowi: Crowi) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { appService } = crowi;

    const isDBInitialized = await appService.isDBInitialized(true);

    if (isDBInitialized) {
      return next(createError(409, 'Application is already installed'));
    }

    return next();
  };

/**
 * Middleware to return HttpError 409 if the application is already installed
 */
export const allreadyInstalledMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  return next(createError(409, 'Application is already installed'));
};

/**
 * Error handler to handle errors as API errors
 */
export const handleAsApiError = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (error == null) {
    next();
    return;
  }

  if (isHttpError(error)) {
    const httpError = error as createError.HttpError;
    res.status(httpError.status).json({ message: httpError.message });
    return;
  }

  next();
};

/**
 * Error handler to redirect to top page on error
 */
export const redirectToTopOnError = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (error != null) {
    res.redirect('/');
    return;
  }
  next();
};
