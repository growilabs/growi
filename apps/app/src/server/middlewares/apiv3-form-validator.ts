import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

import { apiV3ErrorCode } from '~/interfaces/errors/v3-error';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:middlewares:ApiV3FormValidator');

export const apiV3FormValidator = (
  req: Request,
  res: Response & { apiv3Err },
  next: NextFunction,
): void => {
  logger.debug({ query: req.query }, 'req.query');
  logger.debug({ params: req.params }, 'req.params');
  logger.debug({ body: req.body }, 'req.body');

  const errObjArray = validationResult(req);
  if (errObjArray.isEmpty()) {
    next();
    return;
  }

  const errs = errObjArray.array().map((err) => {
    logger.error(`${err.location}.${err.param}: ${err.msg}`);
    return new ErrorV3(
      `${err.param}: ${err.msg}`,
      apiV3ErrorCode.VALIDATION_FAILED,
    );
  });

  res.apiv3Err(errs);
};
