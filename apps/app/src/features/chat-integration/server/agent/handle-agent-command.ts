// The part of accepting an `agent` request that is specific to `agent`
// (design.md HandleAgentCommand, gates 2-4). The command endpoint has already
// judged the channel permission and resolved the linked, writable GROWI user
// (gates 0-1) before calling this.

import {
  type COMMAND_NAMES,
  type CommandRequest,
  type CommandResponse,
  RESPONSE_KINDS,
} from '@growi/chat';
import type { IUser } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { isAiEnabled } from '~/features/mastra/server/services/is-ai-enabled';
import loggerFactory from '~/utils/logger';

import type { CommandAuditContext } from '../command/command-endpoint';
import {
  ChatAgentRequest,
  type ChatAgentRequestDocument,
} from './models/chat-agent-request';

const logger = loggerFactory(
  'growi:features:chat-integration:handle-agent-command',
);

/** Runs an accepted request to its end; started after the `accepted` response. */
export type AgentRequestRunner = (
  request: ChatAgentRequestDocument,
) => Promise<void>;

type AgentCommandRequest = Extract<
  CommandRequest,
  { kind: typeof COMMAND_NAMES.agent }
>;

const ACCEPTED: CommandResponse = { kind: RESPONSE_KINDS.accepted };

/**
 * Requirement 15.4 asks for the reason. Readiness is "enabled AND
 * configured" (`isAiReady`), so once it is false, an enabled GROWI AI can
 * only be missing a model -- the same split the mastra routes' guard makes.
 */
const aiUnavailableMessage = (): string =>
  isAiEnabled()
    ? 'GROWI AI has no AI model configured on this GROWI. Ask your GROWI administrator.'
    : 'GROWI AI is not enabled on this GROWI. Ask your GROWI administrator.';

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

/**
 * `setImmediate` runs after the current turn's microtasks, so the endpoint
 * has written the response before the run begins. Neither a rejection nor a
 * synchronous throw of the runner may reach the endpoint.
 */
const startAfterResponse = (
  runAgentRequest: AgentRequestRunner,
  row: ChatAgentRequestDocument,
): void => {
  setImmediate(() => {
    Promise.resolve()
      .then(() => runAgentRequest(row))
      .catch((error: unknown) => {
        // Name and message only: an HTTP error object carries signed headers.
        const { name, message } =
          error instanceof Error
            ? error
            : { name: 'NonError', message: String(error) };
        logger.error(
          {
            relationId: row.relationId,
            requestId: row.requestId,
            name,
            message,
          },
          'An accepted agent request failed while running',
        );
      });
  });
};

export const handleAgentCommand = async (params: {
  readonly request: AgentCommandRequest;
  readonly user: HydratedDocument<IUser>;
  readonly auditContext: CommandAuditContext;
  readonly aiReady: boolean;
  readonly runAgentRequest: AgentRequestRunner;
}): Promise<CommandResponse> => {
  const { request, user, auditContext, aiReady, runAgentRequest } = params;

  if (!aiReady) {
    return {
      kind: RESPONSE_KINDS.error,
      code: 'ai-unavailable',
      message: aiUnavailableMessage(),
    };
  }

  let row: ChatAgentRequestDocument;
  try {
    // Inserting first is what keeps two copies of the same request arriving
    // together from both running: only one insert can succeed.
    row = await ChatAgentRequest.create({
      relationId: request.relationId,
      requestId: request.requestId,
      userId: user._id,
      text: request.text,
      conversationKey: request.conversationKey,
      actor: request.actor,
      channel: request.channel,
      auditContext,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    // Which unique index reports the duplicate is not fixed, so the row
    // itself decides (tasks.md 5.2 notes): this request's own row means a
    // re-send, which must not be refused -- the proxy would drop its record
    // and lose the answer that is still coming.
    const sameRequest = await ChatAgentRequest.exists({
      relationId: request.relationId,
      requestId: request.requestId,
    });
    if (sameRequest != null) {
      return ACCEPTED;
    }
    return {
      kind: RESPONSE_KINDS.error,
      code: 'busy',
      message:
        'Your previous request to GROWI AI is still being processed. Try again after it finishes.',
    };
  }

  startAfterResponse(runAgentRequest, row);
  return ACCEPTED;
};
