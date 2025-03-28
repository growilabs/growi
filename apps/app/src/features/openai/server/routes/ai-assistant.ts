import { type IUserHasId } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { type UpsertAiAssistantData } from '../../interfaces/ai-assistant';
import { getOpenaiService } from '../services/openai';

import { certifyAiService } from './middlewares/certify-ai-service';
import { upsertAiAssistantValidator } from './middlewares/upsert-ai-assistant-validator';

const logger = loggerFactory('growi:routes:apiv3:openai:create-ai-assistant');

type CreateAssistantFactory = (crowi: Crowi) => RequestHandler[];

type ReqBody = UpsertAiAssistantData;

type Req = Request<undefined, Response, ReqBody> & {
  user: IUserHasId,
}

/**
 * @swagger
 *
 * /openai/ai-assistant:
 *   post:
 *     tags: [OpenAI]
 *     security:
 *       - api_key: []
 *     summary: /openai/ai-assistant
 *     description: Creates a new AI assistant with the given parameters
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               additionalInstruction:
 *                 type: string
 *               pagePathPatterns:
 *                 type: array
 *                 items:
 *                   type: string
 *               grantedGroupsForShareScope:
 *                 type: array
 *                 items:
 *                   type: string
 *               grantedGroupsForAccessScope:
 *                 type: array
 *                 items:
 *                   type: string
 *               shareScope:
 *                 type: string
 *               accessScope:
 *                 type: string
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 aiAssistant:
 *                   $ref: '#/components/schemas/OpenAIAssistant'
 */
export const createAiAssistantFactory: CreateAssistantFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  return [
    accessTokenParser, loginRequiredStrictly, certifyAiService, upsertAiAssistantValidator, apiV3FormValidator,
    async(req: Req, res: ApiV3Response) => {
      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      try {
        const aiAssistantData = { ...req.body, owner: req.user._id };

        const isLearnablePageLimitExceeded = await openaiService.isLearnablePageLimitExceeded(req.user, aiAssistantData.pagePathPatterns);
        if (isLearnablePageLimitExceeded) {
          return res.apiv3Err(new ErrorV3('The number of learnable pages exceeds the limit'), 400);
        }

        const aiAssistant = await openaiService.createAiAssistant(req.body, req.user);

        return res.apiv3({ aiAssistant });
      }
      catch (err) {
        logger.error(err);
        return res.apiv3Err(new ErrorV3('AiAssistant creation failed'));
      }
    },
  ];
};
