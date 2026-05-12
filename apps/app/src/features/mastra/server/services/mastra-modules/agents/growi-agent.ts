import { Agent } from '@mastra/core/agent';

import { configManager } from '~/server/service/config-manager';

import { getOpenaiProvider } from '../../ai-sdk-modules/get-openai-provider';
import { memory } from '../memory';
import { fileSearchTool } from '../tools/file-search-tool';

const model = configManager.getConfig('openai:assistantModel:mastraAgent');

export const growiAgent = new Agent({
  id: 'growiAgent',
  name: 'GROWI Agent',
  instructions: `You are an AI assistant that helps users search and understand content in their GROWI wiki.

  # CRITICAL INSTRUCTION
  - ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.
  - Respond in Markdown. Do NOT wrap your response in JSON or code fences unless the user is asking for code.
  - Use the fileSearch tool when the question relates to the user's wiki content.
  - Keep answers concise and well-structured with headings, lists, and links where helpful.
  `,

  model: getOpenaiProvider()(model),
  tools: { fileSearchTool },
  memory,
});
