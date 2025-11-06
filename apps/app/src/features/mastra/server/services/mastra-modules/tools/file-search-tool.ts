import { createTool, type ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';

import { fileSearch } from '../../ai-sdk-modules/file-search';

const inputSchema = z.object({
  prompt: z.string().describe('user prompt'),
  instruction: z.string().describe('instruction for file search'),
});

type FileSearchToolExecutionContext = ToolExecutionContext<typeof inputSchema>;

export const fileSearchTool = createTool({
  id: 'file-search-tool',
  description: "Get results based on user prompts using OpenAI's fileSearch'",
  inputSchema,
  outputSchema: z.object({
    output: z.any().describe('file search results'),
  }),

  execute: async ({
    context,
    runtimeContext,
  }: FileSearchToolExecutionContext) => {
    const vectorStoreId = runtimeContext.get('vectorStoreId');

    // Type-safe access to runtimeContext variables
    if (typeof vectorStoreId !== 'string') {
      throw new Error('vectorStoreId is required in runtimeContext');
    }

    const result = await fileSearch({ ...context, vectorStoreId });

    return { output: result.text };
  },
});
