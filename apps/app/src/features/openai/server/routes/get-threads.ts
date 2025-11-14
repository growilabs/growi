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

import { getOpenaiService } from '../services/openai';
import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:get-threads');

type GetThreadsFactory = (crowi: Crowi) => RequestHandler[];

type ReqParams = {
  aiAssistantId: string;
};

type Req = Request<ReqParams, Response, undefined> & {
  user: IUserHasId;
};

export const getThreadsFactory: GetThreadsFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(
    crowi,
  );

  const validator: ValidationChain[] = [
    param('aiAssistantId')
      .isMongoId()
      .withMessage('aiAssistantId must be string'),
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
        const { aiAssistantId } = req.params;

        const isAiAssistantUsable = await openaiService.isAiAssistantUsable(
          aiAssistantId,
          req.user,
        );
        if (!isAiAssistantUsable) {
          return res.apiv3Err(
            new ErrorV3('The specified AI assistant is not usable'),
            400,
          );
        }

        const threads =
          await openaiService.getThreadsByAiAssistantId(aiAssistantId);

        return res.apiv3({ threads });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get threads'));
      }
    },
  ];
};
