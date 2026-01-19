import assert from 'node:assert';
import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param } from 'express-validator';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { getOpenaiService } from '../services/openai';
import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:get-threads');

type Req = Request<Record<string, string>, ApiV3Response, undefined> & {
  user?: IUserHasId;
};

export const getThreadsFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator = [
    param('aiAssistantId')
      .isMongoId()
      .withMessage('aiAssistantId must be string'),
  ];

  return [
    // biome-ignore lint/suspicious/noTsIgnore: Suppress auto fix by lefthook
    // @ts-ignore - Scope type causes "Type instantiation is excessively deep" with tsgo
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequiredStrictly middleware)',
      );

      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      try {
        const { aiAssistantId } = req.params;
        assert(
          aiAssistantId != null,
          'aiAssistantId is required (validated by express-validator)',
        );

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
