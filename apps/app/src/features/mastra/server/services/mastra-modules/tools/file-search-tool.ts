import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

import { fileSearch } from '../../ai-sdk-modules/file-search';

export const fileSearchTool = createTool({
  id: 'file-search-tool',
  description: "Get results based on user prompts using OpenAI's fileSearch'",
  inputSchema: z.object({
    prompt: z.string().describe('user prompt'),
    instruction: z.string().describe('instruction for file search'),
    vectorStoreId: z.string().describe('vector store ID'),
  }),
  outputSchema: z.object({
    output: z.any().describe('file search results'),
  }),

  execute: async({ context, runtimeContext }) => {
    const vectorStoreId = runtimeContext.get('vectorStoreId');
    const result = await fileSearch({ ...context, vectorStoreId });

    return { output: result.text };
  },
});
