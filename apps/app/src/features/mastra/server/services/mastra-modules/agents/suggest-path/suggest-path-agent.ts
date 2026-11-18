import { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';

import { resolveMastraModel } from '../../../ai-sdk-modules/resolve-mastra-model';
import { meterModelForRequest } from '../../../usage-metering';
import { getPageContentTool } from '../../tools/get-page-content-tool';
import { SUGGEST_PATH_INSTRUCTIONS } from './instructions';
import { limitedSearchTool } from './limited-search-tool';
import { listChildrenTool } from './list-children-tool';
import type { SuggestPathRequestContextShape } from './request-context';

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
  // existing error handling. The engine sets the model key it resolved once per
  // request; without one, resolveMastraModel falls back to the default model.
  // Per-request metering wrap: see ai-usage-metering design.md, agent integration note.
  model: async ({
    requestContext,
  }: {
    requestContext: RequestContext<SuggestPathRequestContextShape>;
  }) =>
    meterModelForRequest(
      requestContext,
      'suggest-path',
      await resolveMastraModel(requestContext.get('modelKey')),
    ),
  tools: {
    fullTextSearch: limitedSearchTool,
    getPageContent: getPageContentTool,
    listChildren: listChildrenTool,
  },
  // memory is intentionally NOT connected: the agent is stateless and needs
  // no thread persistence.
});
