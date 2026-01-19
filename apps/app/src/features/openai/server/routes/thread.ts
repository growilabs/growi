import assert from 'node:assert';
import type { IUserHasId } from '@growi/core/dist/interfaces';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { body } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { ThreadType } from '../../interfaces/thread-relation';
import { getOpenaiService } from '../services/openai';
import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:thread');

type ReqBody = {
  type: ThreadType;
  aiAssistantId?: string;
  initialUserMessage?: string;
};

type CreateThreadReq = Request<
  Record<string, string>,
  ApiV3Response,
  ReqBody
> & {
  user?: IUserHasId;
};

export const createThreadHandlersFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator = [
    body('type')
      .isIn(Object.values(ThreadType))
      .withMessage('type must be one of "editor" or "knowledge"'),
    body('aiAssistantId')
      .optional()
      .isMongoId()
      .withMessage('aiAssistantId must be string'),
    body('initialUserMessage')
      .optional()
      .isString()
      .withMessage('initialUserMessage must be string'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
    ...validator,
    apiV3FormValidator,
    async (req: CreateThreadReq, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequiredStrictly middleware)',
      );

      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      const { type, aiAssistantId, initialUserMessage } = req.body;

      // express-validator ensures aiAssistantId is a string

      try {
        const thread = await openaiService.createThread(
          user._id,
          type,
          aiAssistantId,
          initialUserMessage,
        );
        return res.apiv3(thread);
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(err);
      }
    },
  ];
};
