// Types of the chat integration's AI entry. Kept apart from the modules so the
// command path can name them without loading anything (`import type` only:
// no-eager-ai-imports.spec.ts follows any other import form).
import type { AnswerSource, ConversationMessage } from '@growi/chat';
import type { IUserHasId } from '@growi/core';
import type { Agent, AgentExecutionOptionsBase } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';

import type { getOrCreateThread } from '~/features/mastra/server/services/get-or-create-thread';
import type { MastraRequestContextShape } from '~/features/mastra/server/services/mastra-modules/types/request-context';

export interface AiRunContext {
  /** The linked GROWI user: the AI reads only what this user can read. */
  readonly user: IUserHasId;
  readonly signal: AbortSignal;
}

export type RequestClassification =
  | { readonly intent: 'answer' }
  | { readonly intent: 'summarize-to-page'; readonly path: string | null };

export interface AnswerRequest {
  readonly text: string;
  readonly relationId: string;
  readonly conversationKey: string;
}

export interface AnswerResult {
  readonly markdown: string;
  readonly sources: ReadonlyArray<AnswerSource>;
}

export interface SummaryResult {
  readonly title: string;
  readonly body: string;
}

/**
 * `aborted` whenever the signal had fired by the time the call settled, with no
 * partial value. A failure while the signal is still live rejects instead.
 */
export type GrowiAiRunOutcome<T> =
  | { readonly kind: 'completed'; readonly value: T }
  | { readonly kind: 'aborted' };

export interface GrowiAiGateway {
  classify(
    text: string,
    context: AiRunContext,
  ): Promise<GrowiAiRunOutcome<RequestClassification>>;
  answer(
    request: AnswerRequest,
    context: AiRunContext,
  ): Promise<GrowiAiRunOutcome<AnswerResult>>;
  summarize(
    messages: ReadonlyArray<ConversationMessage>,
    instruction: string,
    context: AiRunContext,
  ): Promise<GrowiAiRunOutcome<SummaryResult>>;
}

export type GrowiAiRunMeterOutcome = 'completed' | 'failed';

/** The per-call setup the browser's AI chat does for one request. */
export interface GrowiAiRun {
  readonly requestContext: RequestContext<MastraRequestContextShape>;
  readonly providerOptions: AgentExecutionOptionsBase<unknown>['providerOptions'];
  /** Closes the call's usage record. */
  readonly finish: (outcome: GrowiAiRunMeterOutcome) => void;
}

/** What the loader hands the gateway: GROWI's AI, with nothing else. */
export interface GrowiAiRuntime {
  /** `growiAgent` from the Mastra registry. */
  readonly agent: Pick<Agent, 'generate' | 'getMemory'>;
  readonly getOrCreateThread: typeof getOrCreateThread;
  readonly beginRun: (user: IUserHasId) => GrowiAiRun;
}

export type GrowiAiRuntimeLoader = () => Promise<GrowiAiRuntime>;
