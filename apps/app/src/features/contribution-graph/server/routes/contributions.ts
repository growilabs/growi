import type { Request, Router } from 'express';
import express from 'express';
import { query } from 'express-validator';

import { ContributionCacheManager } from '~/features/contribution-graph/server/services/cache-manager';
import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../../../server/crowi';
import { apiV3FormValidator } from '../../../../server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../../../../server/routes/apiv3/interfaces/apiv3-response';

const logger = loggerFactory('growi:routes:apiv3:contribution');

type ReqQuery = {
  targetUserId: string;
};

type ContributionRequest = Request<
  Record<string, string>,
  ApiV3Response,
  undefined,
  ReqQuery
>;

const validator = [
  query('targetUserId')
    .notEmpty()
    .withMessage('user ID is required')
    .isMongoId()
    .withMessage('user ID must be a MongoDB ID'),
];

module.exports = (crowi: Crowi): Router => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const router = express.Router();

  router.get(
    '/',
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: ContributionRequest, res: ApiV3Response) => {
      const targetUserId = req.query.targetUserId;

      try {
        const cacheManager = new ContributionCacheManager();
        const contributions = await cacheManager.getUpdatedCache(targetUserId);

        return res.apiv3({ contributions });
      } catch (err) {
        logger.error('Failed to get contributions', err);
        return res.apiv3Err(err, 500);
      }
    },
  );

  return router;
};
