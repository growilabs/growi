import type { IUserHasId } from '@growi/core';
import { getIdStringForRef, SCOPE } from '@growi/core';
import { ErrorV3 } from '@growi/core/dist/models';
import { toAISdkStream } from '@mastra/ai-sdk';
import { RequestContext } from '@mastra/core/request-context';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  type UIMessageStreamWriter,
} from 'ai';
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
import { mastra } from '../services/mastra-modules';
import type { summarizeAgent } from '../services/mastra-modules/agents/summarize';
import type {
  PageReadBudget,
  SummarizeRequestContextShape,
} from '../services/mastra-modules/agents/summarize/request-context';
import { resolveStepToolChoice } from '../services/mastra-modules/agents/summarize/step-tool-choice';
import { resolveChatErrorMessage } from './chat-error-message';
import {
  buildSummarizeMessageValidator,
  isAbsent,
} from './summarize-message-validator';
import {
  INITIAL_RELAY_STATE,
  isCompleteSummary,
  type SummaryRelayState,
  trackSummaryChunk,
} from './summarize-stream-outcome';

const logger = loggerFactory('growi:routes:apiv3:mastra:summarize-message');

// Characters, and the step count that reads up to them — see design.md
// "SummarizeMessageRoute".
const PAGE_READ_LIMIT = 60_000;
const MAX_STEPS = 6;

type ReqBody = {
  pageId?: string;
  pagePath?: string | null;
  modelKey?: string;
};

type Req = Request<Record<string, string>, Response, ReqBody> & {
  user: IUserHasId;
};

type SummarizeMessageHandlersFactory = (crowi: Crowi) => RequestHandler[];

type SummarizeStream = Awaited<ReturnType<typeof summarizeAgent.stream>>;
type SummaryPage = HydratedDocument<PageDocument>;

// Viewer-filtered lookup only (metadata + permission gate); the body is read
// exclusively by the agent's getPageContentTool loop.
const findPageForViewer = (
  { pageId, pagePath }: ReqBody,
  user: IUserHasId,
): Promise<SummaryPage | null> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  if (!isAbsent(pageId)) {
    return Page.findByIdAndViewer(pageId, user);
  }
  if (!isAbsent(pagePath)) {
    return Page.findByPathAndViewer(pagePath, user, null, true);
  }
  return Promise.resolve(null);
};

const buildSummarizeRequest = (page: SummaryPage, lang?: string): string => {
  const languageLine =
    lang != null && lang !== ''
      ? `\nWrite the summary in the language of the locale "${lang}".`
      : '';
  return `Summarize the wiki page (pageId: ${page._id.toString()}, path: ${JSON.stringify(page.path)}).${languageLine}`;
};

// A failure inside the 200 stream is not a failure to the fail-safe
// finalizer — see design.md "SummarizeMessageRoute". take() yields the
// context at most once, so repeated calls record at most one row.
const recordUnsettledAttempt = (activityId: string | undefined): void => {
  if (activityId == null) return;
  const context = pendingActivityContext.take(activityId);
  if (context != null) {
    void recordFailsafeAttempt(activityId, context);
  }
};

const startSummarizeStream = (
  req: Req,
  res: ApiV3Response,
  crowi: Crowi,
  page: SummaryPage,
): Promise<SummarizeStream> => {
  const summarizeAgent = mastra.getAgent('summarizeAgent');
  // Throws when no model is available; the caller answers 500.
  const effectiveModelKey = resolveEffectiveModelKey(req.body.modelKey);

  // Built per request so concurrent summaries never share a budget. The same
  // object is read by the tool and by the per-step tool gate.
  const pageReadBudget: PageReadBudget = { used: 0, limit: PAGE_READ_LIMIT };
  const requestContext = new RequestContext<SummarizeRequestContextShape>();
  requestContext.set('user', req.user);
  requestContext.set('searchService', crowi.searchService);
  requestContext.set('modelKey', effectiveModelKey);
  requestContext.set('pageReadBudget', pageReadBudget);
  requestContext.set('targetPageId', page._id.toString());

  // Stops the LLM run when the client disconnects mid-stream.
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) {
      abortController.abort();
    }
  });

  return summarizeAgent.stream(buildSummarizeRequest(page, req.user.lang), {
    requestContext,
    maxSteps: MAX_STEPS,
    prepareStep: ({ stepNumber }) =>
      resolveStepToolChoice(pageReadBudget, stepNumber, MAX_STEPS),
    providerOptions: getProviderOptionsForModel(effectiveModelKey),
    abortSignal: abortController.signal,
  });
};

// Same sanitize points as post-message.ts: the toAISdkStream hook covers
// error chunks, the createUIMessageStream hook covers execute-level throws.
const onChatError = (error: unknown): string => {
  logger.error(error);
  return resolveChatErrorMessage(error);
};

const relaySummaryChunks = async (
  stream: SummarizeStream,
  writer: UIMessageStreamWriter,
): Promise<SummaryRelayState> => {
  const reader = toAISdkStream(stream, {
    from: 'agent',
    version: 'v6',
    sendReasoning: true,
    onError: onChatError,
  }).getReader();

  let state = INITIAL_RELAY_STATE;
  while (true) {
    // biome-ignore lint/performance/noAwaitInLoops: necessary to read stream sequentially
    const { value, done } = await reader.read();
    if (done) return state;
    state = trackSummaryChunk(state, value);
    writer.write(value);
  }
};

type SummaryRun = {
  readonly req: Req;
  readonly res: ApiV3Response;
  readonly crowi: Crowi;
  readonly page: SummaryPage;
  readonly stream: SummarizeStream;
  readonly startMetadata: CustomUIMessageMetadata;
  // Undefined when addActivity failed to begin tracking.
  readonly activityId: string | undefined;
};

const recordCompletedSummary = ({
  req,
  crowi,
  page,
  activityId,
}: SummaryRun): void => {
  incrementAiSummarizeGeneratedCount();
  // Without an activityId the listener would settle a bare row.
  if (activityId == null) return;
  // Emitted inside execute, i.e. before the response finishes — see
  // rules/activity-recording.md.
  crowi.events.activity.emit('update', activityId, {
    action: SupportedAction.ACTION_PAGE_AI_SUMMARIZE,
    targetModel: SupportedTargetModel.MODEL_PAGE,
    target: page,
    contributor: req.user,
  });
};

const settleSummaryRun = async (
  run: SummaryRun,
  writer: UIMessageStreamWriter,
  state: SummaryRelayState,
): Promise<void> => {
  const { res, stream, activityId } = run;
  // The fail-safe finalizer has recorded that attempt.
  if (res.destroyed) return;
  // The client already got the error chunk; awaiting the stream's promises
  // here could reject and send it a second one.
  if (state.hasErrorChunk) {
    recordUnsettledAttempt(activityId);
    return;
  }

  const [usage, finishReason, steps] = await Promise.all([
    stream.usage,
    stream.finishReason,
    stream.steps,
  ]);
  // The client may have left while the promises above settled.
  if (res.destroyed) return;

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

  if (isCompleteSummary(finishReason, state)) {
    recordCompletedSummary(run);
  } else {
    recordUnsettledAttempt(activityId);
  }
};

const pipeSummaryRun = (run: SummaryRun): void => {
  const uiMessageStream = createUIMessageStream({
    onError: (error) => {
      recordUnsettledAttempt(run.activityId);
      return onChatError(error);
    },
    execute: async ({ writer }) => {
      writer.write({
        type: 'message-metadata',
        messageMetadata: run.startMetadata,
      });
      const state = await relaySummaryChunks(run.stream, writer);
      await settleSummaryRun(run, writer, state);
    },
  });

  pipeUIMessageStreamToResponse({
    response: run.res,
    stream: uiMessageStream,
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
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
        try {
          const page = await findPageForViewer(req.body, req.user);
          // A page without a revision has nothing to summarize and no
          // sourceRevisionId to report.
          if (page?.revision == null) {
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
          // 'close' may already have fired during the lookup; the fail-safe
          // finalizer has recorded that attempt.
          if (res.destroyed) return;

          const startMetadata: CustomUIMessageMetadata = {
            // Unpopulated query: page.revision is the ObjectId itself.
            sourceRevisionId: getIdStringForRef(page.revision),
            capturedAt: new Date().toISOString(),
          };
          const stream = await startSummarizeStream(req, res, crowi, page);
          pipeSummaryRun({
            req,
            res,
            crowi,
            page,
            stream,
            startMetadata,
            activityId: res.locals.activity?._id,
          });
        } catch (error) {
          // A disconnect aborts stream(); the fail-safe finalizer has
          // recorded that attempt.
          if (res.destroyed) return;
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
