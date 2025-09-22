import { streamText } from 'ai';

import { getOpenaiProvider } from './get-openai-provider';

type StreamTextResult = ReturnType<typeof streamText>;

export const generatePreMessage = async({ prompt }: { prompt: string }): Promise<StreamTextResult> => {
  const openai = getOpenaiProvider();
  return streamText({
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
};
