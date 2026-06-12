import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { toAISdkStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessage,
  validateUIMessages,
} from 'ai';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import { resolveProviderOptions } from '../services/ai-sdk-modules/resolve-provider-options';
import { getOrCreateThread } from '../services/get-or-create-thread';
import { mastra } from '../services/mastra-modules';
import type { MastraRequestContextShape } from '../services/mastra-modules/types/request-context';
import { buildPostMessageValidator } from './post-message-validator';

const logger = loggerFactory('growi:routes:apiv3:mastra:post-message-handler');

type ReqBody = {
  threadId?: string;
  messages: UIMessage[];
};

type Req = Request<undefined, Response, ReqBody> & {
  user: IUserHasId;
};

type PostMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];

export const postMessageHandlersFactory: PostMessageHandlersFactory = (
  crowi,
) => {
  const loginRequiredStrictly =
    require('~/server/middlewares/login-required').default(crowi);

  const validator = buildPostMessageValidator(validateUIMessages);

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { threadId, messages } = req.body;

      const requestContext = new RequestContext<MastraRequestContextShape>();

      // The chat endpoint is assistant-independent: no aiAssistantId lookup and
      // no vectorStore-derived context. AI-enabled gating is enforced at the
      // router level (see ./index.ts).
      requestContext.set('user', req.user);
      requestContext.set('searchService', crowi.searchService);

      const growiAgent = mastra.getAgent('growiAgent');
      const memory = await growiAgent.getMemory();
      if (memory == null) {
        return res.apiv3Err(new ErrorV3('Mastra Memory is not available'), 500);
      }

      const thread = await getOrCreateThread({
        memory,
        resourceId: req.user._id.toString(),
        threadId,
      });

      try {
        const stream = await growiAgent.stream(messages, {
          requestContext,
          memory: {
            thread: thread.id,
            resource: thread.resourceId,
          },
          // Provider options (reasoning etc.) resolved from the
          // AI_PROVIDER_OPTIONS env var (Req 6). Defaults to the OpenAI
          // reasoning options (reasoningEffort 'low' bounds reasoning-token cost;
          // reasoningSummary 'auto' surfaces summary chunks to the UI — note this
          // requires a verified OpenAI org, otherwise summary parts are empty).
          // Operators of other vendors set their own provider namespace; the AI
          // SDK reads only the active provider's key.
          providerOptions: resolveProviderOptions(),
        });

        // Use pipeUIMessageStreamToResponse for Express servers
        // Express requires piping to ServerResponse object, not returning Web API Response
        // See: https://ai-sdk.dev/cookbook/api-servers/express#ui-message-stream
        // Example: https://github.com/vercel/ai/blob/c5e2a7c22eb8d9392705d1e87458b1d4af9c6ec9/examples/express/src/server.ts
        const uiMessageStream = createUIMessageStream({
          originalMessages: messages,
          execute: async ({ writer }) => {
            // Workaround for https://github.com/mastra-ai/mastra/issues/11884#issuecomment-3799153269
            // toAISdkStream() returns a ReadableStream that lacks [Symbol.asyncIterator]
            // in the TypeScript types, so iterate manually via a reader.
            const reader = toAISdkStream(stream, {
              from: 'agent',
              version: 'v6',
              sendReasoning: true,
            }).getReader();

            while (true) {
              // biome-ignore lint/performance/noAwaitInLoops: necessary to read stream sequentially
              const { value, done } = await reader.read();
              if (done) break;
              writer.write(value);
            }

            const usage = await stream.usage;
            logger.info(
              {
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                reasoningTokens: usage.reasoningTokens,
              },
              'Token usage',
            );
          },
        });

        return pipeUIMessageStreamToResponse({
          response: res,
          stream: uiMessageStream,
          // Bypass Express `compression()` middleware (it honours `no-transform`)
          // and disable nginx proxy buffering so SSE chunks reach the client
          // immediately instead of being buffered until the stream ends.
          headers: {
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          },
        });
      } catch (error) {
        logger.error(error);
        if (!res.headersSent) {
          return res.apiv3Err(new ErrorV3('Failed to post message'));
        }
      }
    },
  ];
};
