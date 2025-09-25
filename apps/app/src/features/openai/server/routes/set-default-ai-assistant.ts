import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { type ValidationChain, param, body } from 'express-validator';
import { isHttpError } from 'http-errors';

import { SCOPE } from '@growi/core/dist/interfaces';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import AiAssistantModel from '../models/ai-assistant';
import { getOpenaiService } from '../services/openai';

import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:set-default-ai-assistants');

type setDefaultAiAssistantFactory = (crowi: Crowi) => RequestHandler[];

type ReqParams = {
  id: string,
}

type ReqBody = {
  isDefault: boolean,
}

type Req = Request<ReqParams, Response, ReqBody>

export const setDefaultAiAssistantFactory: setDefaultAiAssistantFactory = (crowi) => {
  const adminRequired = require('~/server/middlewares/admin-required')(crowi);
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  const validator: ValidationChain[] = [
    param('id').isMongoId().withMessage('aiAssistant id is required'),
    body('isDefault').isBoolean().withMessage('isDefault is required'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], { acceptLegacy: true }),
    loginRequiredStrictly, adminRequired, certifyAiService, validator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      try {
        const { id } = req.params;
        const { isDefault } = req.body;

        const updatedAiAssistant = await AiAssistantModel.setDefault(id, isDefault);
        return res.apiv3({ updatedAiAssistant });
      }
      catch (err) {
        logger.error(err);

        if (isHttpError(err)) {
          return res.apiv3Err(new ErrorV3(err.message), err.status);
        }

        return res.apiv3Err(new ErrorV3('Failed to update AiAssistant'));
      }
    },
  ];
};
