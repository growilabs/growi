import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { MongoDBStore } from '@mastra/mongodb';

import { configManager } from '~/server/service/config-manager';

import { getOpenaiProvider } from '../../ai-sdk-modules/get-openai-provider';
import { fileSearchTool } from '../tools/file-search-tool';
import { memory } from '../memory';



const model = configManager.getConfig('openai:assistantModel:chat');

export const growiAgent = new Agent({
  name: 'GROWI Agent',
  instructions: `You are an AI assistant that shows detailed reasoning.

  # CRITICAL INSTRUCTION
  - ALWAYS RESPOND IN THE SAME LANGUAGE AS THE USER'S INPUT.

  For every response, structure your thinking as:
  1. ANALYSIS: What information do I need? What tools should I use?
  2. TOOL EXECUTION: Execute necessary tools with clear reasoning
  3. SYNTHESIS: How do the tool results answer the question?
  4. CONCLUSION: Final answer based on evidence

  Always use the structured output format to organize your reasoning.
  `,

  model: getOpenaiProvider()(model),
  tools: { fileSearchTool },
  memory,
});
