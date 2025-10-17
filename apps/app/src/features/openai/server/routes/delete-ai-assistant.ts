import { type IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { type ValidationChain, param } from 'express-validator';
import { isHttpError } from 'http-errors';


import { SCOPE } from '@growi/core/dist/interfaces';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { deleteAiAssistant } from '../services/delete-ai-assistant';

import { certifyAiService } from './middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:delete-ai-assistants');


type DeleteAiAssistantsFactory = (crowi: Crowi) => RequestHandler[];

type ReqParams = {
  id: string,
}

type Req = Request<ReqParams, Response, undefined> & {
  user: IUserHasId,
}

export const deleteAiAssistantsFactory: DeleteAiAssistantsFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  const validator: ValidationChain[] = [
    param('id').isMongoId().withMessage('aiAssistant id is required'),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], { acceptLegacy: true }), loginRequiredStrictly, certifyAiService, validator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const { id } = req.params;
      const { user } = req;

      try {
        const deletedAiAssistant = await deleteAiAssistant(user._id, id);
        return res.apiv3({ deletedAiAssistant });
      }
      catch (err) {
        logger.error(err);

        if (isHttpError(err)) {
          return res.apiv3Err(new ErrorV3(err.message), err.status);
        }

        return res.apiv3Err(new ErrorV3('Failed to delete AiAssistants'));
      }
    },
  ];
};
