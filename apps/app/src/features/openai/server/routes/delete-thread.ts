import assert from 'node:assert';
import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';
import { param } from 'express-validator';
import { isHttpError } from 'http-errors';

import type Crowi from '~/server/crowi/index.js';
import { accessTokenParser } from '~/server/middlewares/access-token-parser/index.js';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator.js';
import loginRequiredFactory from '~/server/middlewares/login-required.js';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response.js';
import loggerFactory from '~/utils/logger/index.js';

import type { IApiv3DeleteThreadParams } from '../../interfaces/thread-relation.js';
import ThreadRelationModel from '~/features/openai/server/models/thread-relation.js';
import { getOpenaiService } from '~/features/openai/server/services/openai.js';
import { certifyAiService } from '~/features/openai/server/routes/middlewares/certify-ai-service.js';

const logger = loggerFactory('growi:routes:apiv3:openai:delete-thread');

type ReqParams = IApiv3DeleteThreadParams;

type Req = Request<ReqParams, ApiV3Response, undefined> & {
  user?: IUserHasId;
};

export const deleteThreadFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator = [
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
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { aiAssistantId, threadRelationId } = req.params;
      const { user } = req;
      assert(
        user != null,
        'user is required (ensured by loginRequiredStrictly middleware)',
      );

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
        const threadRelation = await ThreadRelationModel.findOne({
          _id: threadRelationId,
          userId: user._id,
        });
        if (threadRelation == null) {
          return res.apiv3Err(new ErrorV3('Thread not found'), 404);
        }

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
