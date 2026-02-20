import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param, type ValidationChain } from 'express-validator';
import { isHttpError } from 'http-errors';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { mastra } from '../services/mastra-modules';

const logger = loggerFactory('growi:routes:apiv3:mastra:delete-thread');

type DeleteThreadHandlersFactory = (crowi: Crowi) => RequestHandler[];

type ReqParams = {
  threadId: string;
};

type Req = Request<ReqParams, Response, undefined> & {
  user: IUserHasId;
};

export const deleteThreadHandlersFactory: DeleteThreadHandlersFactory = (
  crowi,
) => {
  const loginRequiredStrictly =
    require('~/server/middlewares/login-required').default(crowi);

  const validator: ValidationChain[] = [
    param('threadId').isUUID().withMessage('threadId is required'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { threadId } = req.params;

      try {
        const growiAgent = mastra.getAgent('growiAgent');
        const memory = await growiAgent.getMemory();
        if (memory == null) {
          return res.apiv3Err(
            new ErrorV3('Mastra Memory is not available'),
            500,
          );
        }

        const thread = memory.getThreadById({ threadId });
        if (thread == null) {
          return res.apiv3Err(new ErrorV3('Thread not found'), 404);
        }

        await memory.deleteThread(threadId);

        return res.apiv3({
          deletedThreadId: threadId,
        });
      } catch (err) {
        logger.error(err);

        if (isHttpError(err)) {
          return res.apiv3Err(new ErrorV3(err.message), err.status);
        }

        return res.apiv3Err(new ErrorV3('Failed to delete thread'));
      }
    },
  ];
};
