import type { IUserHasId } from '@growi/core';
import { getIdStringForRef, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { toAISdkStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import { createUIMessageStream, pipeUIMessageStreamToResponse } from 'ai';
import type { Request, RequestHandler } from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';

import { incrementAiSummarizeGeneratedCount } from '~/features/opentelemetry/server/custom-metrics/ai-summarize-metrics';
import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { accessTokenParser } from '~/server/middlewares/access-token-parser';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { apiV3FormValidator } from '~/server/middlewares/apiv3-form-validator';
import loginRequiredFactory from '~/server/middlewares/login-required';
import type { PageDocument, PageModel } from '~/server/models/page';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import {
  pendingActivityContext,
  recordFailsafeAttempt,
} from '~/server/service/activity/index';
import loggerFactory from '~/utils/logger';

import type { CustomUIMessageMetadata } from '../../interfaces/chat-message';
import { resolveEffectiveModelKey } from '../services/ai-sdk-modules/llm-providers/effective-model-key';
import { getProviderOptionsForModel } from '../services/ai-sdk-modules/resolve-provider-options';
import { getOrCreateThread } from '../services/get-or-create-thread';
import { mastra } from '../services/mastra-modules';
import type { SummarizeRequestContextShape } from '../services/mastra-modules/agents/summarize/request-context';
import { resolveChatErrorMessage } from './chat-error-message';
import { buildSummarizeMessageValidator } from './summarize-message-validator';

const logger = loggerFactory('growi:routes:apiv3:mastra:summarize-message');

// 1500 lines / 500 lines per read = 3 reads minimum; maxSteps is the safety
// valve above that (design.md "SummarizeMessageRoute").
const PAGE_READ_LIMIT = 1500;
const MAX_STEPS = 15;

type ReqBody = {
  pageId?: string;
  pagePath?: string;
  modelKey?: string;
};

type Req = Request<Record<string, string>, Response, ReqBody> & {
  user: IUserHasId;
};

type SummarizeMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];

// Viewer-filtered lookup only (metadata + permission gate); the body is read
// exclusively by the agent's getPageContentTool loop.
const findPageForViewer = (
  { pageId, pagePath }: ReqBody,
  user: IUserHasId,
): Promise<HydratedDocument<PageDocument> | null> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  if (pageId != null && pageId !== '') {
    return Page.findByIdAndViewer(pageId, user);
  }
  if (pagePath != null && pagePath !== '') {
    return Page.findByPathAndViewer(pagePath, user, null, true);
  }
  return Promise.resolve(null);
};

const buildSummarizeRequest = (
  pageId: string,
  pagePath: string,
  lang: string | undefined,
): string => {
  const languageLine =
    lang != null && lang !== ''
      ? `\nWrite the summary in the language of the locale "${lang}".`
      : '';
  return `Summarize the wiki page (pageId: ${pageId}, path: ${JSON.stringify(pagePath)}).${languageLine}`;
};

// A failure inside the 200 stream is not a failure to the fail-safe
// finalizer — see rules/activity-recording.md. take() yields the context at
// most once, so repeated calls record at most one row.
const recordUnsettledAttempt = (activityId: string): void => {
  const context = pendingActivityContext.take(activityId);
  if (context != null) {
    void recordFailsafeAttempt(activityId, context);
  }
};

export const summarizeMessageHandlersFactory: SummarizeMessageHandlersFactory =
  (crowi) => {
    const loginRequiredStrictly = loginRequiredFactory(crowi);
    const addActivity = generateAddActivityMiddleware();

    return [
      accessTokenParser([SCOPE.WRITE.FEATURES.AI], {
        acceptLegacy: true,
      }),
      loginRequiredStrictly,
      // After auth, before validators — see rules/activity-recording.md.
      addActivity,
      ...buildSummarizeMessageValidator(),
      apiV3FormValidator,
      async (req: Req, res: ApiV3Response) => {
        const { modelKey } = req.body;

        try {
          const page = await findPageForViewer(req.body, req.user);
          if (page == null) {
            // Uniform 404 for "not found" and "forbidden" — see
            // rules/page-write-action-403-404.md.
            return res.apiv3Err(
              new ErrorV3(
                'Page is not found or forbidden',
                'not_found_or_forbidden',
              ),
              404,
            );
          }

          // Unpopulated query: page.revision is the ObjectId itself.
          const sourceRevisionId =
            page.revision != null ? getIdStringForRef(page.revision) : '';
          const capturedAt = new Date().toISOString();

          const summarizeAgent = mastra.getAgent('summarizeAgent');
          const memory = await summarizeAgent.getMemory();
          if (memory == null) {
            return res.apiv3Err(
              new ErrorV3('Mastra Memory is not available'),
              500,
            );
          }

          // No threadId: getOrCreateThread mints a fresh one, so a summary
          // always starts a new conversation.
          const thread = await getOrCreateThread({
            memory,
            resourceId: req.user._id.toString(),
          });

          const effectiveModelKey = resolveEffectiveModelKey(modelKey);

          // Built per request so concurrent summaries never share a budget.
          const requestContext =
            new RequestContext<SummarizeRequestContextShape>();
          requestContext.set('user', req.user);
          requestContext.set('searchService', crowi.searchService);
          requestContext.set('modelKey', effectiveModelKey);
          requestContext.set('pageReadBudget', {
            used: 0,
            limit: PAGE_READ_LIMIT,
          });

          // Stops the LLM run when the client disconnects mid-stream.
          const abortController = new AbortController();
          res.on('close', () => {
            if (!res.writableFinished) {
              abortController.abort();
            }
          });
          // 'close' may already have fired during the awaits above.
          if (res.destroyed) {
            abortController.abort();
          }

          const stream = await summarizeAgent.stream(
            buildSummarizeRequest(
              page._id.toString(),
              page.path,
              req.user.lang,
            ),
            {
              requestContext,
              maxSteps: MAX_STEPS,
              memory: {
                thread: thread.id,
                resource: thread.resourceId,
              },
              providerOptions: getProviderOptionsForModel(effectiveModelKey),
              abortSignal: abortController.signal,
            },
          );

          // Same sanitize points as post-message.ts: the toAISdkStream hook
          // covers error chunks, the createUIMessageStream hook covers
          // execute-level throws.
          const onChatError = (error: unknown): string => {
            logger.error(error);
            return resolveChatErrorMessage(error);
          };

          const activityId = res.locals.activity._id;
          const uiMessageStream = createUIMessageStream({
            onError: (error) => {
              recordUnsettledAttempt(activityId);
              return onChatError(error);
            },
            execute: async ({ writer }) => {
              const summarizeMetadata: CustomUIMessageMetadata = {
                threadId: thread.id,
                sourceRevisionId,
                capturedAt,
              };
              writer.write({
                type: 'message-metadata',
                messageMetadata: summarizeMetadata,
              });

              const reader = toAISdkStream(stream, {
                from: 'agent',
                version: 'v6',
                sendReasoning: true,
                onError: onChatError,
              }).getReader();

              let hasErrorChunk = false;
              let hasText = false;
              while (true) {
                // biome-ignore lint/performance/noAwaitInLoops: necessary to read stream sequentially
                const { value, done } = await reader.read();
                if (done) break;
                if (value.type === 'error') {
                  hasErrorChunk = true;
                }
                if (value.type === 'text-delta' && value.delta.trim() !== '') {
                  hasText = true;
                }
                writer.write(value);
              }

              // res.destroyed also covers a disconnect before the close
              // listener above was registered; the fail-safe finalizer has
              // recorded that attempt.
              if (res.destroyed) {
                return;
              }

              const [usage, finishReason, steps] = await Promise.all([
                stream.usage,
                stream.finishReason,
                stream.steps,
              ]);

              const messageMetadata: CustomUIMessageMetadata = { finishReason };
              writer.write({ type: 'message-metadata', messageMetadata });

              logger.info(
                {
                  finishReason,
                  stepCount: steps.length,
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  totalTokens: usage.totalTokens,
                },
                'Summarize stream finished',
              );

              // 'tool-calls' (maxSteps exhausted) and 'length' (truncated)
              // end without a complete summary.
              if (hasErrorChunk || finishReason !== 'stop' || !hasText) {
                recordUnsettledAttempt(activityId);
                return;
              }

              incrementAiSummarizeGeneratedCount();
              // Emitted inside execute, i.e. before the response finishes —
              // see rules/activity-recording.md.
              crowi.events.activity.emit('update', activityId, {
                action: SupportedAction.ACTION_PAGE_AI_SUMMARIZE,
                targetModel: SupportedTargetModel.MODEL_PAGE,
                target: page,
                contributor: req.user,
              });
            },
          });

          return pipeUIMessageStreamToResponse({
            response: res,
            stream: uiMessageStream,
            headers: {
              'Cache-Control': 'no-cache, no-transform',
              'X-Accel-Buffering': 'no',
            },
          });
        } catch (error) {
          logger.error(error);
          if (!res.headersSent) {
            return res.apiv3Err(
              new ErrorV3(resolveChatErrorMessage(error)),
              500,
            );
          }
        }
      },
    ];
  };
