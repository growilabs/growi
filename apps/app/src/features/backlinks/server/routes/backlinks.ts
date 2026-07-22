import type { RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:backlink');

export const getBacklinksHandler = (): RequestHandler => {
  return async (req: CrowiRequest, res: ApiV3Response) => {
    const { toPageId } = req.query;

    if (typeof toPageId !== 'string') {
      return res.apiv3Err('toPageId must be a string', 400);
    }
    try {
      const backlinks = await req.crowi.pageLinkService.findBacklinks(
        new mongoose.Types.ObjectId(toPageId),
        req.user ?? null,
      );
      return res.apiv3({ backlinks });
    } catch (err) {
      logger.error('Failed to get backlinks', err);
      res.apiv3Err(err, 500);
    }
  };
};

export const getBacklinksHandlerFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator: ValidationChain[] = [
    query('toPageId')
      .notEmpty()
      .withMessage('toPageId is required')
      .isMongoId()
      .withMessage('toPageId must be a MongoDB ID'),
  ];

  return [
    loginRequiredStrictly,
    ...validator,
    apiV3FormValidator,
    getBacklinksHandler(),
  ];
};
