import { openai } from '@ai-sdk/openai';
import { Agent } from '@mastra/core/agent';

import { fileSearchTool } from '../tools/file-search-tool';

export const growiAgent = new Agent({
  name: 'GROWI agent',
  instructions: `
    You are an Agent that performs GROWI operations based on prompts from users. Currently, the only supported tool is 'file-search-tool'.
  `,
  model: openai('gpt-4o'),
  tools: { fileSearchTool },
});
