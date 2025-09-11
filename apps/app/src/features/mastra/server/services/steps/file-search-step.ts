import {
  createStep,
} from '@mastra/core/workflows';
import { z } from 'zod';

import { fileSearchWithStream } from '../growi-services/file-search';

export const fileSearchStep = createStep({
  id: 'file-search-step-step',
  inputSchema: z.object({
    prompt: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
  execute: async({ inputData, writer }) => {
    const { prompt } = inputData;

    const fileSearchResult = fileSearchWithStream(prompt);

    for await (const text of fileSearchResult.textStream) {
      await writer.write({
        type: 'file-search-step-event',
        text,
      });
    }

    return {
      value: prompt,
    };
  },
});
