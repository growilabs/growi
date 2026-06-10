import { Agent } from '@mastra/core/agent';

import { resolveMastraModel } from '../../ai-sdk-modules/resolve-mastra-model';
import { memory } from '../memory';
import { fullTextSearchTool } from '../tools/full-text-search-tool';
import { getPageContentTool } from '../tools/get-page-content-tool';

export const growiAgent = new Agent({
  id: 'growiAgent',
  name: 'GROWI Agent',
  instructions: `You are an AI assistant that helps users search and understand content in their GROWI wiki.

  # CRITICAL INSTRUCTION
  - ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.
  - Respond in Markdown. Do NOT wrap your response in JSON or code fences unless the user is asking for code.
  - When a question relates to the user's wiki content, first call the fullTextSearch tool to gather candidate pages. To read a candidate page, call getPageContent WITHOUT \`offset\` first: this returns the page outline (a heading list with line numbers). For a short page the body is small enough that \`content\` is returned in this same first call; for a long page only the \`outline\` comes back. In that case pick the heading whose section likely answers the question and call getPageContent again with \`offset\` set to that heading's \`line\` to fetch that section's \`content\`. Use \`hasMore\` to decide whether to page further with a larger \`offset\`. Do NOT fetch a whole large page at once — pages may exceed thousands of lines, so navigate via the outline. Include the page path you cited in the answer.
  - The fullTextSearch query supports plain natural-language tokens combined with: "phrase", -term, -"phrase", prefix:/path, -prefix:/path, tag:foo, -tag:foo (all AND-combined). Use these operators only when the user intent maps to a subtree, tag, or exclusion.
  - When the user explicitly asks for newest or oldest pages (e.g. "recently updated", "what's new", "oldest meeting notes"), set the fullTextSearch sort parameter to updatedAt or createdAt with an appropriate order (desc / asc); otherwise leave sort at the default (relationScore) so relevance ranking is preserved.
  - Keep answers concise and well-structured with headings, lists, and links where helpful.
  `,

  // Resolve the model lazily (DynamicArgument<MastraModelConfig>): the function
  // runs at use time, not at import time, so constructing the agent never
  // throws even when the vendor/API key are unconfigured (Req 4.3). The
  // availability gate normally prevents reaching a disabled state here; the
  // throw is a defense-in-depth fallback that carries ONLY the reason type —
  // never the API key — so secrets cannot leak into logs (Req 4.1).
  //
  // The `_ctx` ({ requestContext, mastra }) parameter is required by the
  // DynamicArgument function form but ignored: model resolution depends only on
  // server config, not on the per-request context.
  model: (_ctx) => {
    const resolution = resolveMastraModel();
    if (resolution.status !== 'ok') {
      throw new Error(
        `Mastra LLM provider is not available: ${resolution.reason.type}`,
      );
    }
    return resolution.model;
  },
  tools: {
    fullTextSearchTool,
    getPageContentTool,
  },
  memory,
});
