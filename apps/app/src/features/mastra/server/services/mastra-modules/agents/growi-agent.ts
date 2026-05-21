import { Agent } from '@mastra/core/agent';

import { configManager } from '~/server/service/config-manager';

import { getOpenaiProvider } from '../../ai-sdk-modules/get-openai-provider';
import { memory } from '../memory';
// import { fileSearchTool } from '../tools/file-search-tool'; // disabled: see spec agentic-search
import { fullTextSearchTool } from '../tools/full-text-search-tool';
import { getPageContentTool } from '../tools/get-page-content-tool';

const model = configManager.getConfig('openai:assistantModel:mastraAgent');

export const growiAgent = new Agent({
  id: 'growiAgent',
  name: 'GROWI Agent',
  instructions: `You are an AI assistant that helps users search and understand content in their GROWI wiki.

  # CRITICAL INSTRUCTION
  - ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.
  - Respond in Markdown. Do NOT wrap your response in JSON or code fences unless the user is asking for code.
  // - Use the fileSearch tool when the question relates to the user's wiki content.   // disabled: see spec agentic-search
  - When a question relates to the user's wiki content, first call the fullTextSearch tool to gather candidate pages, then call the getPageContent tool for any page whose body you need as evidence. Include the page path you cited in the answer.
  - The fullTextSearch query supports plain natural-language tokens combined with: "phrase", -term, -"phrase", prefix:/path, -prefix:/path, tag:foo, -tag:foo (all AND-combined). Use these operators only when the user intent maps to a subtree, tag, or exclusion.
  - Keep answers concise and well-structured with headings, lists, and links where helpful.
  `,

  model: getOpenaiProvider()(model),
  tools: {
    // fileSearchTool, // disabled: see spec agentic-search
    fullTextSearchTool,
    getPageContentTool,
  },
  memory,
});
