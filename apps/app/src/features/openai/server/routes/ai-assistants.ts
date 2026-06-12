import assert from 'node:assert';
import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response.js';
import loggerFactory from '~/utils/logger/index.js';

import { getOpenaiService } from '../services/openai.js';
import { certifyAiService } from './middlewares/certify-ai-service.js';

const logger = loggerFactory('growi:routes:apiv3:openai:get-ai-assistants');

type Req = Request<Record<string, string>, ApiV3Response, undefined> & {
  user?: IUserHasId;
};

export const getAiAssistantsFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  return [
    accessTokenParser([SCOPE.READ.FEATURES.AI_ASSISTANT], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    certifyAiService,
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
        const accessibleAiAssistants =
          await openaiService.getAccessibleAiAssistants(user);

        return res.apiv3({ accessibleAiAssistants });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get AiAssistants'));
      }
    },
  ];
};
