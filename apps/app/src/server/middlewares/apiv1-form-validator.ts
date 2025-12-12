import type { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

import loggerFactory from '~/utils/logger';

import ApiResponse from '../util/apiResponse';

const logger = loggerFactory('growi:middlewares:ApiV1FormValidator');

export default (req: Request, res: Response, next: NextFunction): void => {
  logger.debug('req.query', req.query);
  logger.debug('req.params', req.params);
  logger.debug('req.body', req.body);

  const errObjArray = validationResult(req);
  if (errObjArray.isEmpty()) {
    next();
    return;
  }

  const errs = errObjArray.array().map((err) => {
    logger.error(`${err.location}.${err.param}: ${err.msg}`);
    return ApiResponse.error(`${err.param}: ${err.msg}`, 'validation_failed');
  });

  res.json(errs);
};
