import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { fileSearch } from '../growi-services/file-search';


export const fileSearchTool = createTool({
  id: 'file-search-tool',
  description: "Get results based on user prompts using OpenAI's fileSearch'",
  inputSchema: z.object({
    prompt: z.string().describe('user prompt'),
  }),
  outputSchema: z.object({
    output: z.any().describe('file search results'),
  }),

  execute: async({ context }) => {
    const { prompt } = context;

    const result = await fileSearch(prompt);

    // Return the result in the expected output property
    return { output: result.text };
  },
});
