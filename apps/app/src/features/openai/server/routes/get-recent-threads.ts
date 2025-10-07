import { type IUserHasId, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query, type ValidationChain } from 'express-validator';
import type { PaginateResult } from 'mongoose';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { ThreadType } from '../../interfaces/thread-relation';
import type { ThreadRelationDocument } from '../models/thread-relation';
import ThreadRelationModel from '../models/thread-relation';
import { getOpenaiService } from '../services/openai';

import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:get-recent-threads');

type GetRecentThreadsFactory = (crowi: Crowi) => RequestHandler[];

type ReqQuery = {
  page?: number;
  limit?: number;
};

type Req = Request<undefined, Response, undefined, ReqQuery> & {
  user: IUserHasId;
};

export const getRecentThreadsFactory: GetRecentThreadsFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validator: ValidationChain[] = [
    query('page')
      .optional()
      .isInt()
      .withMessage('page must be a positive integer'),
    query('page').toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage('limit must be an integer between 1 and 20'),
    query('limit').toInt(),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      try {
        const paginateResult: PaginateResult<ThreadRelationDocument> =
          await ThreadRelationModel.paginate(
            {
              userId: req.user._id,
              type: ThreadType.KNOWLEDGE,
              isActive: true,
            },
            {
              page: req.query.page ?? 1,
              limit: req.query.limit ?? 20,
              sort: { updatedAt: -1 },
              populate: 'aiAssistant',
            },
          );
        return res.apiv3({ paginateResult });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get recent threads'));
      }
    },
  ];
};
