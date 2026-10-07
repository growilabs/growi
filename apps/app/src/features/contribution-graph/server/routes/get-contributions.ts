import type { IUser } from '@growi/core';
import type { Request, RequestHandler } from 'express';
import type { ValidationChain } from 'express-validator';
import { query } from 'express-validator';
import mongoose from 'mongoose';

import loginRequiredFactory from '~/server/middlewares/login-required';
import loggerFactory from '~/utils/logger';

import type Crowi from '../../../../server/crowi';
import { apiV3FormValidator } from '../../../../server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '../../../../server/routes/apiv3/interfaces/apiv3-response';
import type { IContributionsResponse } from '../../interfaces/contribution';
import { assembleEmptyGraph } from '../../utils/contribution-graph-utils';
import { ensureUserHasMigrated } from '../services/contribution-migration-service';
import { getContributions } from '../services/contribution-service';

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

export const getContributionsHandler = (): RequestHandler => {
  return async (req: ContributionRequest, res: ApiV3Response) => {
    const { targetUserId } = req.query;

    if (
      typeof targetUserId !== 'string' ||
      !mongoose.isValidObjectId(targetUserId)
    ) {
      return res.apiv3Err('Invalid user ID', 400);
    }

    const targetObjectId = new mongoose.Types.ObjectId(targetUserId);
    const user = await mongoose.model<IUser>('User').findById(targetObjectId);

    if (user == null) {
      return res.apiv3Err('User not found', 404);
    }

    const isMigrationInProgress = user.contributionsMigratedAt == null;

    if (isMigrationInProgress) {
      void ensureUserHasMigrated(user).catch((err) => {
        logger.error('Background contribution migration failed', err);
      });
    }

    try {
      const { contributions } = await getContributions(targetUserId);
      const contributionsResponse: IContributionsResponse = {
        contributions,
        isMigrationInProgress,
      };
      return res.apiv3(contributionsResponse);
    } catch (err) {
      logger.error('Failed to get contributions', err);

      const fallbackResponse: IContributionsResponse = {
        contributions: assembleEmptyGraph(),
        isTemporaryUnavailable: true,
        isMigrationInProgress,
      };

      return res.apiv3(fallbackResponse);
    }
  };
};

export const getContributionsHandlerFactory = (
  crowi: Crowi,
): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator: ValidationChain[] = [
    query('targetUserId')
      .notEmpty()
      .withMessage('user ID is required')
      .isMongoId()
      .withMessage('user ID must be a MongoDB ID'),
  ];

  return [
    loginRequiredStrictly,
    ...validator,
    apiV3FormValidator,
    getContributionsHandler(),
  ];
};
