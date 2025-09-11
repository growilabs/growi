import { type IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { type ValidationChain, param } from 'express-validator';

import { SCOPE } from '@growi/core/dist/interfaces';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { getOpenaiService } from '../../services/openai';
import { certifyAiService } from '../middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:get-message');

type GetMessagesFactory = (crowi: Crowi) => RequestHandler[];

type ReqParam = {
  threadId: string,
  aiAssistantId: string,
  before?: string,
  after?: string,
  limit?: number,
}

type Req = Request<ReqParam, Response, undefined> & {
  user: IUserHasId,
}

export const getMessagesFactory: GetMessagesFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  const validator: ValidationChain[] = [
    param('threadId').isString().withMessage('threadId must be string'),
    param('aiAssistantId').isMongoId().withMessage('aiAssistantId must be string'),
    param('limit').optional().isInt().withMessage('limit must be integer'),
    param('before').optional().isString().withMessage('before must be string'),
    param('after').optional().isString().withMessage('after must be string'),
  ];

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], { acceptLegacy: true }), loginRequiredStrictly, certifyAiService, validator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      try {
        const {
          threadId, aiAssistantId, limit, before, after,
        } = req.params;

        const isAiAssistantUsable = await openaiService.isAiAssistantUsable(aiAssistantId, req.user);
        if (!isAiAssistantUsable) {
          return res.apiv3Err(new ErrorV3('The specified AI assistant is not usable'), 400);
        }

        const messages = await openaiService.getMessageData(threadId, req.user.lang, {
          limit, before, after, order: 'desc',
        });

        return res.apiv3({ messages });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get messages'));
      }
    },
  ];
};
