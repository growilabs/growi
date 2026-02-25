import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { query, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { mastra } from '../services/mastra-modules';

const logger = loggerFactory('growi:routes:apiv3:mastra:get-threads');

type GetThreadsFactory = (crowi: Crowi) => RequestHandler[];

type ReqQuery = {
  page: number;
  perPage: number;
  field?: 'updatedAt' | 'createdAt';
  direction?: 'ASC' | 'DESC';
};

type Req = Request<undefined, Response, undefined, ReqQuery> & {
  user: IUserHasId;
};

export const getThreadsFactory: GetThreadsFactory = (crowi) => {
  const loginRequiredStrictly =
    require('~/server/middlewares/login-required').default(crowi);

  const validator: ValidationChain[] = [
    query('page')
      .isInt({ min: 0 })
      .toInt()
      .withMessage('"page" must be a number'),

    query('perPage')
      .isInt({ min: 1, max: 20 })
      .toInt()
      .withMessage('"perPage" must be a number between 1 and 20'),

    query('field')
      .optional()
      .isIn(['updatedAt', 'createdAt'])
      .withMessage('"field" must be one of "updatedAt" or "createdAt"'),

    query('direction')
      .optional()
      .isIn(['ASC', 'DESC'])
      .withMessage('"direction" must be one of "ASC" or "DESC"'),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      try {
        const agent = mastra.getAgent('growiAgent');
        const memory = await agent?.getMemory();

        if (memory == null) {
          return res.apiv3Err(
            new ErrorV3('Mastra Memory is not available'),
            501,
          );
        }

        const paginatedThread = await memory.listThreads({
          filter: {
            resourceId: req.user._id.toString(),
          },
          page: req.query.page,
          perPage: req.query.perPage,
          orderBy: {
            field: req.query.field,
            direction: req.query.direction,
          },
        });
        return res.apiv3({ paginatedThread });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get threads'));
      }
    },
  ];
};
