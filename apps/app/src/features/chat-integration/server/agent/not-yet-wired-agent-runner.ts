// INTERIM, NOT THE AGENT FEATURE. Stands in for `runAgentRequest` until task
// 5.6 of the chat-integration-agent spec wires the real runner into
// `createCommandEndpoint`. It produces no answer; it only finishes the row so
// the person is not refused as busy until the row expires a day later.

import loggerFactory from '~/utils/logger';

import type { AgentRequestRunner } from './handle-agent-command';
import { ChatAgentRequest } from './models/chat-agent-request';

const logger = loggerFactory(
  'growi:features:chat-integration:not-yet-wired-agent-runner',
);

let warned = false;

export const notYetWiredAgentRunner: AgentRequestRunner = async (request) => {
  if (!warned) {
    warned = true;
    logger.warn(
      'The chat agent runner is not wired yet (chat-integration-agent task 5.6): accepted agent requests are closed without an answer.',
    );
  }
  await ChatAgentRequest.updateOne(
    {
      relationId: request.relationId,
      requestId: request.requestId,
      state: 'running',
    },
    { state: 'done' },
  );
};
