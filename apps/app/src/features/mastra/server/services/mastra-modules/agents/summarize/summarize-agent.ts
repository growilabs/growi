import { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';

import { resolveMastraModel } from '../../../ai-sdk-modules/resolve-mastra-model';
import { meterModelForRequest } from '../../../usage-metering';
import { SUMMARIZE_INSTRUCTIONS } from './instructions';
import { limitedGetPageContentTool } from './limited-get-page-content-tool';
import type { SummarizeRequestContextShape } from './request-context';

/**
 * Full-page-coverage summarization agent for the ai-summarize feature
 * (design.md "SummarizeAgent").
 *
 * Kept in its own file, independent from growiAgent's Q&A-oriented
 * instructions and tool budgets: neither shares state with the other.
 */
export const summarizeAgent = new Agent({
  id: 'summarizeAgent',
  name: 'Summarize Agent',
  instructions: SUMMARIZE_INSTRUCTIONS,
  // Resolve the model lazily (DynamicArgument<MastraModelConfig>), mirroring
  // growiAgent: the per-request `modelKey` (already allow-list-resolved by
  // the route, see post-message.ts's resolveEffectiveModelKey) is read from
  // requestContext when present; omitted, resolveMastraModel falls back to
  // the effective default. Constructing the agent never throws even when the
  // provider/API key are unconfigured — resolveMastraModel() only throws at
  // request time, surfaced by the route's existing error handling.
  // Per-request metering wrap: see ai-usage-metering design.md, agent integration note.
  model: async ({
    requestContext,
  }: {
    requestContext: RequestContext<SummarizeRequestContextShape>;
  }) =>
    meterModelForRequest(
      requestContext,
      'summarize',
      await resolveMastraModel(requestContext.get('modelKey')),
    ),
  tools: {
    // Same key as growiAgent's page-content tool, so the client's
    // `tool-getPageContentTool` part types cover the summary stream too.
    getPageContentTool: limitedGetPageContentTool,
  },
  // memory is intentionally NOT connected: like suggestPathAgent, a summary
  // is a one-shot run that needs no thread persistence.
});
