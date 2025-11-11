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
  orderBy?: 'updatedAt' | 'createdAt';
  sortDirection?: 'ASC' | 'DESC';
};

type Req = Request<undefined, Response, undefined, ReqQuery> & {
  user: IUserHasId;
};

export const getThreadsFactory: GetThreadsFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validator: ValidationChain[] = [
    query('page')
      .isInt({ min: 1 })
      .toInt()
      .withMessage('"page" must be a number'),

    query('perPage')
      .isInt({ min: 1, max: 20 })
      .toInt()
      .withMessage('"perPage" must be a number between 1 and 20'),

    query('orderBy')
      .optional()
      .isIn(['updatedAt', 'createdAt'])
      .withMessage('"orderBy" must be one of "updatedAt" or "createdAt"'),

    query('sortDirection')
      .optional()
      .isIn(['ASC', 'DESC'])
      .withMessage('"sortDirection" must be one of "ASC" or "DESC"'),
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

        const threads = await memory.getThreadsByResourceIdPaginated({
          resourceId: req.user._id.toString(),
          page: req.query.page - 1,
          perPage: req.query.perPage,
          orderBy: req.query.orderBy,
          sortDirection: req.query.sortDirection,
        });

        return res.apiv3({ threads });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get threads'));
      }
    },
  ];
};
