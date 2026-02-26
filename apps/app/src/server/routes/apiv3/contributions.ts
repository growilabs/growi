import type { IUserHasId } from '@growi/core';
import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';

import { CacheManager } from '~/features/contribution-graph/services/cache-manager';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../crowi';
import { apiV3FormValidator } from '../../middlewares/apiv3-form-validator';
import type { ApiV3Response } from './interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:activity');

const validator = {
  list: [
    query('targetUserId')
      .optional()
      .isMongoId()
      .withMessage('user ID must be a MongoDB ID'),
  ],
};

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

module.exports = (crowi: Crowi): Router => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const router = express.Router();

  router.get(
    '/',
    loginRequiredStrictly,
    validator.list,
    apiV3FormValidator,
    async (req: AuthorizedRequest, res: ApiV3Response) => {
      let targetUserId = req.query.targetUserId;

      if (typeof targetUserId !== 'string') {
        targetUserId = req.user?._id;
      }

      if (!targetUserId) {
        return res.apiv3Err(
          'Target user ID is missing and authenticated user ID is unavailable.',
          400,
        );
      }

      try {
        const cacheManager = new CacheManager();
        const contributions = await cacheManager.getCache(targetUserId);

        return res.apiv3({ contributions });
      } catch (err) {
        logger.error('Failed to get contributions', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  return router;
};
