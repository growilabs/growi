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

import type { IApiv3DeleteThreadParams } from '../../interfaces/thread-relation';
import { getOpenaiService } from '../services/openai';

import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:delete-thread');

type DeleteThreadFactory = (crowi: Crowi) => RequestHandler[];

type ReqParams = IApiv3DeleteThreadParams;

type Req = Request<ReqParams, Response, undefined> & {
  user: IUserHasId;
};

export const deleteThreadFactory: DeleteThreadFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validator: ValidationChain[] = [
    param('aiAssistantId').isMongoId().withMessage('threadId is required'),
    param('threadRelationId')
      .isMongoId()
      .withMessage('threadRelationId is required'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { aiAssistantId, threadRelationId } = req.params;
      const { user } = req;

      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      const isAiAssistantUsable = await openaiService.isAiAssistantUsable(
        aiAssistantId,
        user,
      );
      if (!isAiAssistantUsable) {
        return res.apiv3Err(
          new ErrorV3('The specified AI assistant is not usable'),
          400,
        );
      }

      try {
        const deletedThreadRelation =
          await openaiService.deleteThread(threadRelationId);
        return res.apiv3({ deletedThreadRelation });
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
