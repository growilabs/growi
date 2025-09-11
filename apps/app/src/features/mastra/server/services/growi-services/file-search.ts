import { openai } from '@ai-sdk/openai';
import { streamText, generateText } from 'ai';

type GenerateTextParameters = Parameters<typeof generateText>[0];

const VECTOR_STORE_ID = 'vs_68c26db1ed9c8191bca45369f63f87c8';

const fileSearchSubstance = (prompt: string): GenerateTextParameters => {
  return {
    model: openai('gpt-4o'),
    prompt,
    tools: {
      file_search: openai.tools.fileSearch({
        vectorStoreIds: [VECTOR_STORE_ID],
        maxNumResults: 10,
        ranking: {
          ranker: 'auto',
        },
      }),
    },

    providerOptions: {
      openai: {
        store: true,
      },
    },
    // Force file search tool:
    toolChoice: { type: 'tool', toolName: 'file_search' },
  };
};


export const fileSearch = (prompt: string): ReturnType<typeof generateText> => {
  return generateText(fileSearchSubstance(prompt));
};

export const fileSearchWithStream = (prompt: string): ReturnType<typeof streamText> => {
  return streamText(fileSearchSubstance(prompt));
};
