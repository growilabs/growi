import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { StreamEventName } from '../../../../interfaces/mastra';
import { fileSearchWithStream } from '../ai-sdk-modules/file-search';

export const fileSearchStep = createStep({
  id: 'file-search-step-step',
  inputSchema: z.object({
    prompt: z.string(),
    instruction: z.string(),
    vectorStoreId: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
  execute: async({ inputData, writer }) => {
    const { prompt } = inputData;
    const fileSearchResult = fileSearchWithStream({ ...inputData });
    for await (const text of fileSearchResult.textStream) {
      await writer.write({
        type: StreamEventName.FILE_SEARCH_STEP_EVENT,
        text,
      });
    }
    return {
      value: prompt,
    };
  },
});
