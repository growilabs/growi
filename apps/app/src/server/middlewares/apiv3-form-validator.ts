import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request, Response } from 'express';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middlewares:ApiV3FormValidator');
const { validationResult } = require('express-validator');

export const apiV3FormValidator = (
  req: Request,
  res: Response & { apiv3Err },
  next: NextFunction,
): void => {
  logger.debug('req.query', req.query);
  logger.debug('req.params', req.params);
  logger.debug('req.body', req.body);

  const errObjArray = validationResult(req);
  if (errObjArray.isEmpty()) {
    return next();
  }

  const errs = errObjArray.array().map((err) => {
    logger.error(`${err.location}.${err.param}: ${err.value} - ${err.msg}`);
    return new ErrorV3(`${err.param}: ${err.msg}`, 'validation_failed');
  });

  return res.apiv3Err(errs);
};
