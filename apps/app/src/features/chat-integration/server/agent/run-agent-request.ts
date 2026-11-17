// Running an accepted `agent` request to its answer (design.md
// RunAgentRequest). Every way a run can end stores an answer first and only
// then finishes the row, so the person always hears back (Requirement 15.10)
// and the stale-row sweep can close a row whose run stopped in between.

import type {
  AgentAnswer,
  ChatAccountRef,
  ConversationMessage,
  ConversationResult,
} from '@growi/chat';
import type { IUserHasId } from '@growi/core';

import loggerFactory from '~/utils/logger';

import type { WriteActor } from '../command/perform-write-command';
import type { ResolvedActor } from '../command/resolve-actor';
import type { ChatOutbox } from '../outbox';
import type { ProxyCallResult } from '../proxy-client';
import {
  failedAnswer,
  pageCreatedAnswerOf,
  textAnswerOf,
} from './agent-answer';
import type { AiRunContext, GrowiAiGateway } from './growi-ai-gateway-types';
import type { AgentRequestRunner } from './handle-agent-command';
import type {
  ChatAgentRequestDocument,
  ChatAgentRequestModel,
} from './models/chat-agent-request';
import type { createSummaryPage, SummaryPageResult } from './summary-page';

const logger = loggerFactory(
  'growi:features:chat-integration:run-agent-request',
);

export const AGENT_RUN_TIMEOUT_MS = 5 * 60 * 1000;

export type SummaryPageParams = Omit<
  Parameters<typeof createSummaryPage>[0],
  'crowi'
>;

export interface AgentRunnerDeps {
  readonly gateway: GrowiAiGateway;
  readonly fetchConversation: (
    relationId: string,
    params: { readonly requestId: string },
  ) => Promise<ProxyCallResult<ConversationResult>>;
  readonly outbox: ChatOutbox;
  readonly requests: Pick<ChatAgentRequestModel, 'updateOne'>;
  readonly resolveActor: (
    relationId: string,
    actor: ChatAccountRef,
  ) => Promise<ResolvedActor>;
  readonly isAiReady: () => boolean;
  readonly createSummaryPage: (
    params: SummaryPageParams,
  ) => Promise<SummaryPageResult>;
  readonly siteUrl: () => string;
  readonly now: () => Date;
  /** Defaults to {@link AGENT_RUN_TIMEOUT_MS}; only tests shorten it. */
  readonly timeoutMs?: number;
}

const TIMEOUT = failedAnswer('timeout');
const AGENT_ERROR = failedAnswer('agent-error');

const idsOf = (row: ChatAgentRequestDocument) => ({
  relationId: row.relationId,
  requestId: row.requestId,
});

// The name only: an AI provider's error message can quote the request text
// or a fragment of its API key.
const errorNameOf = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

// GROWI's AI takes the user as `IUserHasId` because that is how the browser
// route declares `req.user`, which at runtime is this same hydrated document.
const asAiUser = (user: WriteActor): IUserHasId =>
  user as unknown as IUserHasId;

/**
 * The accept path checked these gates; they may have changed since. The link
 * must still point at the user the row was accepted for, or the run would act
 * as someone other than the person holding the busy slot.
 */
const currentUserOf = async (
  deps: AgentRunnerDeps,
  row: ChatAgentRequestDocument,
): Promise<WriteActor | null> => {
  const { user, writeDenied } = await deps.resolveActor(
    row.relationId,
    row.actor,
  );
  if (user == null || writeDenied != null || !user._id.equals(row.userId)) {
    return null;
  }
  return user;
};

/** What every step of one run works with. */
interface RunScope {
  readonly deps: AgentRunnerDeps;
  readonly row: ChatAgentRequestDocument;
  readonly user: WriteActor;
  readonly context: AiRunContext;
}

type ReadConversation =
  | {
      readonly kind: 'read';
      readonly messages: ReadonlyArray<ConversationMessage>;
      readonly truncated: boolean;
    }
  | { readonly kind: 'failed'; readonly answer: AgentAnswer };

const readConversationOf = (
  result: ProxyCallResult<ConversationResult>,
  row: ChatAgentRequestDocument,
): ReadConversation => {
  if (!result.ok) {
    // No `conversationFailure`: the proxy then words it as "could not read
    // the conversation, try again later".
    logger.warn(
      { ...idsOf(row), callFailure: result.reason },
      'The conversation of an agent request could not be fetched',
    );
    return {
      kind: 'failed',
      answer: failedAnswer('conversation-unavailable'),
    };
  }
  const conversation = result.response;
  if (!conversation.ok) {
    return {
      kind: 'failed',
      answer: failedAnswer('conversation-unavailable', conversation.failure),
    };
  }
  if (conversation.messages.length === 0) {
    return {
      kind: 'failed',
      answer: failedAnswer('conversation-unavailable', {
        reason: 'empty',
        remedy: null,
      }),
    };
  }
  return {
    kind: 'read',
    messages: conversation.messages,
    truncated: conversation.truncated,
  };
};

/** Neither the proxy call nor the page creation takes the signal. */
const summaryAnswerOf = async (
  { deps, row, user, context }: RunScope,
  requestedPath: string | null,
): Promise<AgentAnswer> => {
  const fetched = await deps.fetchConversation(row.relationId, {
    requestId: row.requestId,
  });
  if (context.signal.aborted) return TIMEOUT;
  const conversation = readConversationOf(fetched, row);
  if (conversation.kind === 'failed') return conversation.answer;

  const summary = await deps.gateway.summarize(
    conversation.messages,
    row.text,
    context,
  );
  if (summary.kind === 'aborted') return TIMEOUT;

  const page = await deps.createSummaryPage({
    user,
    requestedPath,
    title: summary.value.title,
    body: summary.value.body,
    now: deps.now(),
    auditContext: row.auditContext,
  });
  // No deadline check here: a page that exists is linked even when it was
  // finished after the limit (otherwise the person never learns where it is).
  if (page.kind === 'failed') return failedAnswer(page.reason);

  return pageCreatedAnswerOf({
    siteUrl: deps.siteUrl(),
    pageId: page.pageId,
    messages: conversation.messages,
    truncated: conversation.truncated,
  });
};

const produceAnswer = async (
  deps: AgentRunnerDeps,
  row: ChatAgentRequestDocument,
  signal: AbortSignal,
): Promise<AgentAnswer> => {
  // Requirement 15.4 holds at run time too: AI turned off after acceptance
  // must not be called. The protocol has no "AI unavailable" answer.
  if (!deps.isAiReady()) {
    logger.warn(idsOf(row), 'GROWI AI became unavailable before the run');
    return AGENT_ERROR;
  }
  const user = await currentUserOf(deps, row);
  if (user == null) {
    logger.warn(idsOf(row), 'The requester may no longer act on this GROWI');
    return AGENT_ERROR;
  }

  const context: AiRunContext = { user: asAiUser(user), signal };
  const classification = await deps.gateway.classify(row.text, context);
  if (classification.kind === 'aborted') return TIMEOUT;

  if (classification.value.intent === 'answer') {
    const outcome = await deps.gateway.answer(
      {
        text: row.text,
        relationId: row.relationId,
        conversationKey: row.conversationKey,
      },
      context,
    );
    return outcome.kind === 'aborted' ? TIMEOUT : textAnswerOf(outcome.value);
  }
  return summaryAnswerOf(
    { deps, row, user, context },
    classification.value.path,
  );
};

const answerFor = async (
  deps: AgentRunnerDeps,
  row: ChatAgentRequestDocument,
  signal: AbortSignal,
): Promise<AgentAnswer> => {
  try {
    return await produceAnswer(deps, row, signal);
  } catch (error) {
    if (signal.aborted) return TIMEOUT;
    logger.error(
      { ...idsOf(row), errorName: errorNameOf(error) },
      'An agent request failed',
    );
    return AGENT_ERROR;
  }
};

/**
 * Store the answer, then finish the row. A duplicate means another writer
 * (the stale-row sweep, or an earlier run) already answered, so only the row
 * is finished. Any other failure leaves the row running for the sweep: a row
 * finished without an answer would leave the person unanswered.
 */
const recordAnswer = async (
  deps: AgentRunnerDeps,
  row: ChatAgentRequestDocument,
  answer: AgentAnswer,
): Promise<void> => {
  try {
    await deps.outbox.enqueue({
      kind: 'command-answer',
      relationId: row.relationId,
      requestId: row.requestId,
      answer,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      logger.error(
        { ...idsOf(row), errorName: errorNameOf(error) },
        'The answer to an agent request could not be stored; the row is left for the stale-row sweep',
      );
      return;
    }
  }
  await deps.requests.updateOne(
    { relationId: row.relationId, requestId: row.requestId, state: 'running' },
    { state: 'done' },
  );
  logger.info({ ...idsOf(row), answer: answer.kind }, 'Agent request answered');
};

/** Never rejects: the accept path starts it after responding and does not wait. */
export const createAgentRequestRunner =
  (deps: AgentRunnerDeps): AgentRequestRunner =>
  async (row) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      deps.timeoutMs ?? AGENT_RUN_TIMEOUT_MS,
    );
    try {
      const answer = await answerFor(deps, row, controller.signal);
      await recordAnswer(deps, row, answer);
    } catch (error) {
      logger.error(
        { ...idsOf(row), errorName: errorNameOf(error) },
        'An agent request could not be finished',
      );
    } finally {
      clearTimeout(timer);
    }
  };
