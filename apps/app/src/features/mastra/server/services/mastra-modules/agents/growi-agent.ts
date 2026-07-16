import { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';

import { resolveMastraModel } from '../../ai-sdk-modules/resolve-mastra-model';
import { memory } from '../memory';
import { fullTextSearchTool } from '../tools/full-text-search-tool';
import { getPageContentTool } from '../tools/get-page-content-tool';
import type { MastraRequestContextShape } from '../types/request-context';

export const growiAgent = new Agent({
  id: 'growiAgent',
  name: 'GROWI Agent',
  instructions: `You are an AI assistant that helps users search and understand content in their GROWI wiki.

  # CRITICAL INSTRUCTION
  - ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.
  - Respond in Markdown. Do NOT wrap your response in JSON or code fences unless the user is asking for code.
  - When a question relates to the user's wiki content, first call the fullTextSearch tool to gather candidate pages. To read a candidate page, call getPageContent WITHOUT \`offset\` first: this returns the page outline (a heading list with line numbers). For a short page the body is small enough that \`content\` is returned in this same first call; for a long page only the \`outline\` comes back. In that case pick the heading whose section likely answers the question and call getPageContent again with \`offset\` set to that heading's \`line\` to fetch that section's \`content\`. Use \`hasMore\` to decide whether to page further with a larger \`offset\`. Do NOT fetch a whole large page at once — pages may exceed thousands of lines, so navigate via the outline.
  - Do NOT output URLs or Markdown links to wiki pages in your answer, and never invent a site URL or domain. The UI automatically lists the pages you opened (via getPageContent) as separate "sources" the user can navigate from. You may refer to a page by its title or path in prose, but never render it as a link.
  - The fullTextSearch query supports plain natural-language tokens combined with: "phrase", -term, -"phrase", prefix:/path, -prefix:/path, tag:foo, -tag:foo (all AND-combined). Use these operators only when the user intent maps to a subtree, tag, or exclusion.
  - When the user explicitly asks for newest or oldest pages (e.g. "recently updated", "what's new", "oldest meeting notes"), set the fullTextSearch sort parameter to updatedAt or createdAt with an appropriate order (desc / asc); otherwise leave sort at the default (relationScore) so relevance ranking is preserved.
  - Keep answers concise and well-structured with headings and lists where helpful.
  `,

  // Resolve the model per request (DynamicArgument<MastraModelConfig>): the
  // function runs at use time, not at import time, so constructing the agent
  // never throws even when the provider/API key are unconfigured (Req 4.3). The
  // per-request `modelKey` is read from the RequestContext, where post-message has
  // already stored the EFFECTIVE (allow-list-resolved) key; resolveMastraModel
  // re-validates it against the allow-list, which for that already-resolved key is
  // an idempotent defense-in-depth pass (the client value was rounded upstream, so
  // it is never trusted here either). On misconfiguration resolveMastraModel()
  // throws; the throw surfaces at request time and is handled by the post-message
  // route's existing try/catch (Req 4.3). Its message carries only the provider
  // name / missing-var name — never the API key (Req 1.9).
  //
  // The parameter is annotated with the shared shape so `get('modelKey')` is
  // typed as `string | undefined` (the agent is constructed without an explicit
  // TRequestContext, so it would otherwise be `RequestContext<unknown>`).
  model: ({
    requestContext,
  }: {
    requestContext: RequestContext<MastraRequestContextShape>;
  }) => resolveMastraModel(requestContext.get('modelKey')),
  tools: {
    fullTextSearchTool,
    getPageContentTool,
  },
  memory,
});
