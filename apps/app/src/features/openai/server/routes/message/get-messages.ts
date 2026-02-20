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

import ThreadRelationModel from '../../models/thread-relation';
import { getOpenaiService } from '../../services/openai';
import { certifyAiService } from '../middlewares/certify-ai-service';

const logger = loggerFactory('growi:routes:apiv3:openai:get-message');

type ReqParam = {
  threadId?: string;
  aiAssistantId?: string;
  before?: string;
  after?: string;
  limit?: number;
};

type Req = Request<ReqParam, ApiV3Response, undefined> & {
  user?: IUserHasId;
};

export const getMessagesFactory = (crowi: Crowi): RequestHandler[] => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator = [
    param('threadId').isString().withMessage('threadId must be string'),
    param('aiAssistantId')
      .isMongoId()
      .withMessage('aiAssistantId must be string'),
    param('limit').optional().isInt().withMessage('limit must be integer'),
    param('before').optional().isString().withMessage('before must be string'),
    param('after').optional().isString().withMessage('after must be string'),
  ];

  return [
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
        const { threadId, aiAssistantId, limit, before, after } = req.params;

        assert(
          threadId != null && aiAssistantId != null,
          'threadId and aiAssistantId are required (validated by express-validator)',
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

        const threadRelation = await ThreadRelationModel.findOne({
          threadId: { $eq: threadId },
          userId: user._id,
        });
        if (threadRelation == null) {
          return res.apiv3Err(new ErrorV3('Thread not found'), 404);
        }

        const messages = await openaiService.getMessageData(
          threadId,
          user.lang,
          {
            limit,
            before,
            after,
            order: 'desc',
          },
        );

        return res.apiv3({ messages });
      } catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('Failed to get messages'));
      }
    },
  ];
};
