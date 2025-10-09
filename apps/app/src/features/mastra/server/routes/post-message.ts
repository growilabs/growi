import type { IUserHasId } from '@growi/core';
import { SCOPE, isPopulated } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { RuntimeContext } from '@mastra/core/runtime-context';
import { pipeUIMessageStreamToResponse, validateUIMessages, type UIMessage } from 'ai';
import type { Request, RequestHandler } from 'express';
import { body, type ValidationChain } from 'express-validator';
import { z } from 'zod';

import AiAssistantModel from '~/features/openai/server/models/ai-assistant';
import { getOpenaiService } from '~/features/openai/server/services/openai';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { mastra } from '../services/mastra-modules';

const logger = loggerFactory('growi:routes:apiv3:mastra:post-message-handler');


type ReqBody = {
  aiAssistantId: string,
  messages: UIMessage[],
}

type Req = Request<undefined, Response, ReqBody> & {
  user: IUserHasId,
}

type PostMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];

const runtimeContext = new RuntimeContext<{ vectorStoreId: string }>();

const reasoningSchema = z.object({
  thoughtProcess: z.array(z.object({
    step: z.string(),
    reasoning: z.string(),
    conclusion: z.string(),
  })),
  finalAnswer: z.string(),
});

export const postMessageHandlersFactory: PostMessageHandlersFactory = (crowi) => {
  const loginRequiredStrictly = require('~/server/middlewares/login-required')(crowi);

  const validator: ValidationChain[] = [
    body('aiAssistantId')
      .isMongoId()
      .withMessage('aiAssistantId must be string'),

    body('messages')
      .custom(async(data) => {
        await validateUIMessages({ messages: data });
      }),
  ];

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI_ASSISTANT], { acceptLegacy: true }),
    loginRequiredStrictly, ...validator, apiV3FormValidator, async(req: Req, res: ApiV3Response) => {
      const { aiAssistantId, messages } = req.body;

      const openaiService = getOpenaiService();
      if (openaiService == null) {
        return res.apiv3Err(new ErrorV3('GROWI AI is not enabled'), 501);
      }

      const isAiAssistantUsable = await openaiService.isAiAssistantUsable(aiAssistantId, req.user);
      if (!isAiAssistantUsable) {
        return res.apiv3Err(new ErrorV3('The specified AI assistant is not usable'), 400);
      }

      const aiAssistant = await AiAssistantModel.findById(aiAssistantId);
      if (aiAssistant == null) {
        return res.apiv3Err(new ErrorV3('AI assistant not found'), 404);
      }

      const aiAssistantWithPopulatedVectorStore = await aiAssistant.populate('vectorStore');
      if (!isPopulated(aiAssistantWithPopulatedVectorStore.vectorStore)) {
        return res.apiv3Err(new ErrorV3('Vector store not found'), 404);
      }

      const vectorStoreId = aiAssistantWithPopulatedVectorStore.vectorStore.vectorStoreId;
      runtimeContext.set('vectorStoreId', vectorStoreId);

      const growiAgent = mastra.getAgent('growiAgent');

      try {
        const stream = await growiAgent.streamVNext(
          messages, {
            format: 'aisdk',
            output: reasoningSchema,
            runtimeContext,
          },
        );

        // debug: log all chunks from the full stream
        // for await (const chunk of stream.fullStream) {
        //   console.log(chunk);
        // }

        // Use pipeUIMessageStreamToResponse for Express servers
        // Express requires piping to ServerResponse object, not returning Web API Response
        // See: https://ai-sdk.dev/cookbook/api-servers/express#ui-message-stream
        // Example: https://github.com/vercel/ai/blob/c5e2a7c22eb8d9392705d1e87458b1d4af9c6ec9/examples/express/src/server.ts
        return pipeUIMessageStreamToResponse({
          response: res,
          stream: stream.toUIMessageStream(),
        });
      }

      catch (error) {
        logger.error(error);
        if (!res.headersSent) {
          return res.apiv3Err(new ErrorV3('Failed to post message'));
        }
      }
    },
  ];
};
