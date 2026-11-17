import type Crowi from '~/server/crowi';
import { growiInfoService } from '~/server/service/growi-info';

import { resolveActor } from '../command/resolve-actor';
import { chatOutbox } from '../outbox';
import { fetchConversation } from '../proxy-client';
import { createGrowiAiGateway } from './growi-ai-gateway';
import type { AgentRequestRunner } from './handle-agent-command';
import { growiAiRuntimeLoaderFor } from './load-growi-ai-runtime';
import { ChatAgentRequest } from './models/chat-agent-request';
import { createAgentRequestRunner } from './run-agent-request';
import { createSummaryPage } from './summary-page';

const siteUrl = (): string => growiInfoService.getSiteUrl();

/**
 * The runner production uses. Built on the first run, so `crowi.searchService`
 * is read once it exists; GROWI's AI itself loads only on the first AI call.
 */
export const agentRequestRunnerFor = (crowi: Crowi): AgentRequestRunner => {
  let runner: AgentRequestRunner | undefined;
  return (row) => {
    runner ??= createAgentRequestRunner({
      gateway: createGrowiAiGateway({
        loadRuntime: growiAiRuntimeLoaderFor(crowi.searchService),
        siteUrl,
      }),
      fetchConversation: (relationId, params) =>
        fetchConversation(relationId, params),
      outbox: chatOutbox,
      requests: ChatAgentRequest,
      resolveActor,
      isAiReady: () => crowi.isAiReady(),
      createSummaryPage: (params) => createSummaryPage({ crowi, ...params }),
      siteUrl,
      now: () => new Date(),
    });
    return runner(row);
  };
};
