import type { ErrorRequestHandler } from 'express';
import { isHttpError } from 'http-errors';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middleware:htto-error-handler');

const httpErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // handle if the err is a HttpError instance
  if (isHttpError(err)) {
    const httpError = err;

    try {
      return res.status(httpError.status).send({
        status: httpError.status,
        message: httpError.message,
      });
    } catch (e) {
      logger.error('Cannot call res.send() twice:', e);
    }
  }

  next(err);
};

export default httpErrorHandler;
