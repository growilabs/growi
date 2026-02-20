import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { fileSearch } from '../../ai-sdk-modules/file-search';

const inputSchema = z.object({
  prompt: z.string().describe('user prompt'),
  instruction: z.string().describe('instruction for file search'),
});

export const fileSearchTool = createTool({
  id: 'file-search-tool',
  description: "Get results based on user prompts using OpenAI's fileSearch'",
  inputSchema,
  outputSchema: z.object({
    output: z.any().describe('file search results'),
  }),

  execute: async (inputData, context) => {
    const vectorStoreId = context?.requestContext?.get('vectorStoreId');

    // Type-safe access to requestContext variables
    if (typeof vectorStoreId !== 'string') {
      throw new Error('vectorStoreId is required in requestContext');
    }

    const result = await fileSearch({ ...inputData, vectorStoreId });

    return { output: result.text };
  },
});
