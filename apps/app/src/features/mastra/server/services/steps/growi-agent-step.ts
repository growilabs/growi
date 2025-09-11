import {
  createStep,
} from '@mastra/core/workflows';
import { z } from 'zod';

// eslint-disable-next-line import/no-cycle
import { mastra } from '..';

export const growiAgentStep = createStep({
  id: 'growi-agent-step',
  inputSchema: z.object({
    prompt: z.string(),
  }),
  outputSchema: z.object({
    value: z.string(),
  }),
  execute: async({ inputData, writer }) => {
    const { prompt } = inputData;

    const agent = mastra.getAgent('growiAgent');
    const stream = await agent.streamVNext(prompt);

    for await (const chunk of stream.fullStream) {
      if (chunk.type === 'text-delta') {
        await writer.write({
          type: 'growi-agent-step-event',
          text: chunk.payload.text,
        });
      }
    }

    return {
      value: stream.text,
    };
  },
});
