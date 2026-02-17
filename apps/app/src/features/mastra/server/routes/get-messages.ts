import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param, type ValidationChain } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { mastra } from '../services/mastra-modules';

const logger = loggerFactory('growi:routes:apiv3:mastra:get-message');

export type GetMessagesHandlersFactory = (crowi: Crowi) => RequestHandler[];

export type ReqParam = {
  threadId: string;
};

export type Req = Request<ReqParam, Response, undefined> & {
  user: IUserHasId;
};

export const getMessagesHandlersFactory: GetMessagesHandlersFactory = (
  crowi,
) => {
  const loginRequiredStrictly =
    require('~/server/middlewares/login-required').default(crowi);

  const validator: ValidationChain[] = [
    param('threadId')
      .isUUID()
      .optional()
      .withMessage('threadId must be a valid UUID'),
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
        const { threadId } = req.params;

        const agent = mastra.getAgent('growiAgent');
        const memory = await agent?.getMemory();

        if (memory == null) {
          return res.apiv3Err(
            new ErrorV3('Mastra Memory is not available'),
            501,
          );
        }

        // TODO: Pagination
        const messages = await memory.recall({
          threadId,
          perPage: false,
        });

        return res.apiv3({ messages });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get messages'));
      }
    },
  ];
};
