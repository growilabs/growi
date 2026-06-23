import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { toAISdkStream } from '@mastra/ai-sdk';
import type { AIV6Type } from '@mastra/core/agent/message-list';
import { RequestContext } from '@mastra/core/request-context';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  validateUIMessages,
} from 'ai';
import type { Request, RequestHandler } from 'express';

import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import loggerFactory from '~/utils/logger';

import type { CustomUIMessageMetadata } from '../../interfaces/chat-message';
import { resolveProviderOptions } from '../services/ai-sdk-modules/resolve-provider-options';
import { getOrCreateThread } from '../services/get-or-create-thread';
import { mastra } from '../services/mastra-modules';
import type { MastraRequestContextShape } from '../services/mastra-modules/types/request-context';
import { resolveChatErrorMessage } from './chat-error-message';
import { buildPostMessageValidator } from './post-message-validator';

const logger = loggerFactory('growi:routes:apiv3:mastra:post-message-handler');

type ReqBody = {
  threadId?: string;
  messages: AIV6Type.UIMessage[];
};

type Req = Request<Record<string, string>, Response, ReqBody> & {
  user: IUserHasId;
};

type PostMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];

export const postMessageHandlersFactory: PostMessageHandlersFactory = (
  crowi,
) => {
  const loginRequiredStrictly = loginRequiredFactory(crowi);

  const validator = buildPostMessageValidator(validateUIMessages);

  return [
    accessTokenParser([SCOPE.WRITE.FEATURES.AI], {
      acceptLegacy: true,
    }),
    loginRequiredStrictly,
    ...validator,
    apiV3FormValidator,
    async (req: Req, res: ApiV3Response) => {
      const { threadId, messages } = req.body;

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

      const requestContext = new RequestContext<MastraRequestContextShape>();

      // Request-scoped context the agent's tools read at execute time: the
      // logged-in user (for viewer-aware page access) and the search service
      // (for the full-text search tool). AI-enabled gating is handled at the
      // router level (see ./index.ts).
      requestContext.set('user', req.user);
      requestContext.set('searchService', crowi.searchService);

      try {
        const stream = await growiAgent.stream(messages, {
          requestContext,
          maxSteps: 10,
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
        // A streaming failure (e.g. a misconfigured / unsupported model) arrives
        // as an error *chunk* from toAISdkStream — NOT a thrown exception — so it
        // never reaches createUIMessageStream's onError. The chunk converter calls
        // toAISdkStream's own onError to build the chunk text, so that is the
        // primary sanitize point. createUIMessageStream's onError covers the rare
        // execute-level throw (e.g. `stream.usage` rejecting): it must stay,
        // because that hook's DEFAULT (getErrorMessage) forwards the RAW message
        // — dropping it would leak detail on that path.
        //
        // Forward only a safe message: an AISDKError's provider-authored text
        // (one line), never the stack / responseBody / url, and never a
        // non-AISDK (possibly GROWI-internal) error's message (OWASP
        // LLM02/LLM09). The full error is logged server-side.
        const onChatError = (error: unknown): string => {
          logger.error(error);
          return resolveChatErrorMessage(error);
        };

        const uiMessageStream = createUIMessageStream({
          originalMessages: messages,
          onError: onChatError,
          execute: async ({ writer }) => {
            // Workaround for https://github.com/mastra-ai/mastra/issues/11884#issuecomment-3799153269
            // toAISdkStream() returns a ReadableStream that lacks [Symbol.asyncIterator]
            // in the TypeScript types, so iterate manually via a reader.
            const reader = toAISdkStream(stream, {
              from: 'agent',
              version: 'v6',
              sendReasoning: true,
              // Primary sanitize point: the agent→UI chunk converter calls this
              // with the original error to build the error chunk's text.
              onError: onChatError,
            }).getReader();

            while (true) {
              // biome-ignore lint/performance/noAwaitInLoops: necessary to read stream sequentially
              const { value, done } = await reader.read();
              if (done) break;
              writer.write(value);
            }

            const [usage, finishReason, steps] = await Promise.all([
              stream.usage,
              stream.finishReason,
              stream.steps,
            ]);

            // Typed against the shared CustomUIMessageMetadata so the written
            // shape stays in sync with what the client reads as
            // `message.metadata` (see ../../interfaces/chat-message). The
            // relayed mastra chunks carry `unknown` metadata, so the stream
            // itself is left ungenerified; this annotation is the write-side
            // contract.
            const messageMetadata: CustomUIMessageMetadata = { finishReason };
            writer.write({ type: 'message-metadata', messageMetadata });

            logger.info(
              {
                finishReason,
                stepCount: steps.length,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                totalTokens: usage.totalTokens,
                reasoningTokens: usage.reasoningTokens,
              },
              'Stream finished',
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
