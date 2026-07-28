import { Agent } from '@mastra/core/agent';

import { resolveMastraModel } from '../../../ai-sdk-modules/resolve-mastra-model';
import { getPageContentTool } from '../../tools/get-page-content-tool';
import { SUGGEST_PATH_INSTRUCTIONS } from './instructions';
import { limitedSearchTool } from './limited-search-tool';
import { listChildrenTool } from './list-children-tool';

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
  // Resolve the model lazily (DynamicArgument<MastraModelConfig>): the function
  // runs at use time, not at import time, so a config change takes effect
  // without a server restart (Requirement 3.4) and constructing the agent never
  // throws even when the provider/API key are unconfigured. On misconfiguration
  // resolveMastraModel() throws at request time, surfaced by the engine's
  // existing error handling. The provider-agnostic AI layer (support/mastra)
  // resolves a single app-wide model, so suggestPath no longer selects its own.
  model: () => resolveMastraModel(),
  tools: {
    fullTextSearch: limitedSearchTool,
    getPageContent: getPageContentTool,
    listChildren: listChildrenTool,
  },
  // memory is intentionally NOT connected: the agent is stateless and needs
  // no thread persistence.
});
