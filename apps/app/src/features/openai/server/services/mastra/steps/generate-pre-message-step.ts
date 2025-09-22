
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';

import { generatePreMessage } from '../ai-sdk-modules/generate-pre-message';

export const generatePreMessageStep = createStep({
  id: 'generate-pre-message-step',
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
    const result = await generatePreMessage({ prompt });
    for await (const text of result.textStream) {
      await writer.write({
        type: 'pre-message-step-event',
        text,
      });
    }

    return {
      value: prompt,
    };
  },
});
