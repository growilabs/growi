import { Agent } from '@mastra/core/agent';

import { configManager } from '~/server/service/config-manager';

import { getOpenaiProvider } from '../../../ai-sdk-modules/get-openai-provider';
import { getPageContentTool } from '../../tools/get-page-content-tool';
import { listChildrenTool } from '../../tools/list-children-tool';
import { SUGGEST_PATH_INSTRUCTIONS } from './instructions';
import { limitedSearchTool } from './limited-search-tool';

/**
 * Save-location exploration agent for suggestPath (design.md "SuggestPathAgent").
 *
 * The structured output schema is intentionally NOT attached here: the
 * agentic engine passes it at generate-time (dependency direction — the
 * mastra layer must not know suggest-path types).
 */
export const suggestPathAgent = new Agent({
  id: 'suggestPathAgent',
  name: 'Suggest Path Agent',
  instructions: SUGGEST_PATH_INSTRUCTIONS,
  // DynamicArgument: resolved per request so that a config change takes
  // effect without a server restart (Requirement 3.4). The function is
  // evaluated ~2x per generate (research.md Spike item 3) — keep it cheap
  // and side-effect-free.
  model: () =>
    getOpenaiProvider()(
      configManager.getConfig('openai:assistantModel:suggestPathAgent'),
    ),
  tools: {
    fullTextSearch: limitedSearchTool,
    getPageContent: getPageContentTool,
    listChildren: listChildrenTool,
  },
  // memory is intentionally NOT connected: the agent is stateless and needs
  // no thread persistence.
});
