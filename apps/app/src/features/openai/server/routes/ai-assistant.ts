import assert from 'node:assert';
import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import { certifyAiService } from '~/features/openai/server/routes/middlewares/certify-ai-service.js';
import { upsertAiAssistantValidator } from '~/features/openai/server/routes/middlewares/upsert-ai-assistant-validator.js';
import { getOpenaiService } from '~/features/openai/server/services/openai.js';
import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response.js';
import loggerFactory from '~/utils/logger/index.js';

import type { UpsertAiAssistantData } from '../../interfaces/ai-assistant.js';

const logger = loggerFactory('growi:routes:apiv3:openai:create-ai-assistant');

type ReqBody = UpsertAiAssistantData;

type Req = Request<Record<string, string>, ApiV3Response, ReqBody> & {
  user?: IUserHasId;
};

export const createAiAssistantFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
    ...upsertAiAssistantValidator,
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
        const aiAssistantData = { ...req.body, owner: user._id };

        const isLearnablePageLimitExceeded =
          await openaiService.isLearnablePageLimitExceeded(
            user,
            aiAssistantData.pagePathPatterns,
          );
        if (isLearnablePageLimitExceeded) {
          return res.apiv3Err(
            new ErrorV3('The number of learnable pages exceeds the limit'),
            400,
          );
        }

        const aiAssistant = await openaiService.createAiAssistant(
          req.body,
          user,
        );

        return res.apiv3({ aiAssistant });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('AiAssistant creation failed'));
      }
    },
  ];
};
