import { SCOPE } from '@growi/core';
import type { RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:routes:apiv3:backlink');

export const getBacklinksHandler = (crowi: Crowi): RequestHandler => {
  return async (req: CrowiRequest, res: ApiV3Response) => {
    const { pageId } = req.query;

    if (typeof pageId !== 'string') {
      return res.apiv3Err('pageId must be a string', 400);
    }
    try {
      const backlinks = await crowi.pageLinkService.findBacklinks(
        new mongoose.Types.ObjectId(pageId),
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
  const loginRequired = loginRequiredFactory(crowi, true);

  const validator: ValidationChain[] = [
    query('pageId')
      .notEmpty()
      .withMessage('pageId is required')
      .isMongoId()
      .withMessage('pageId must be a MongoDB ID'),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.PAGE]),
    loginRequired,
    ...validator,
    apiV3FormValidator,
    getBacklinksHandler(crowi),
  ];
};
