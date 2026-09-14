import { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';

import { resolveMastraModel } from '../../../ai-sdk-modules/resolve-mastra-model';
import { memory } from '../../memory';
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
  model: ({
    requestContext,
  }: {
    requestContext: RequestContext<SummarizeRequestContextShape>;
  }) => resolveMastraModel(requestContext.get('modelKey')),
  tools: {
    // Registered under the SAME key growiAgent uses for its page-content
    // tool ('getPageContentTool'), NOT a summarize-specific key. The
    // LLM-provider tool name is this `tools` record's key, not the tool's
    // own `id` — so after the summary completes and growiAgent takes over
    // the thread for follow-up questions, the past tool-call it replays
    // from history still names a tool that exists in growiAgent's own
    // tool set (Requirement 1.4).
    getPageContentTool: limitedGetPageContentTool,
  },
  // memory IS connected (unlike suggestPathAgent, which is stateless): the
  // post-summary follow-up conversation needs this thread's history
  // (Requirement 1.4).
  memory,
});
