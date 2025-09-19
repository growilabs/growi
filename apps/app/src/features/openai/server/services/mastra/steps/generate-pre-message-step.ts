
import { createStep } from '@mastra/core/workflows';
import { streamText } from 'ai';
import { z } from 'zod';

import { getOpenaiProvider } from '../ai-sdk-modules/get-openai-provider';

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
    const openai = getOpenaiProvider();
    const result = streamText({
      model: openai('gpt-4.1-nano'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Generate a brief confirmation message based on the user\'s message' },
          ],
        },
      ],
    });

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
