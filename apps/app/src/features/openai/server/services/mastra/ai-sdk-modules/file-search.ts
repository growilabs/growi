import { streamText, generateText } from 'ai';

import { configManager } from '~/server/service/config-manager';

import { getOpenaiProvider } from './get-openai-provider';

type FileSearchParameters = {
  prompt: string,
  instruction: string,
  vectorStoreId: string,
}

// Extracted types from ai-sdk
type GenerateTextConfig = Parameters<typeof generateText>[0];
type StreamTextConfig = Parameters<typeof streamText>[0];
type GenerateTextResult = ReturnType<typeof generateText>;
type StreamTextResult = ReturnType<typeof streamText>;

function fileSearchSubstance(params: FileSearchParameters): GenerateTextConfig;
function fileSearchSubstance(params: FileSearchParameters): StreamTextConfig;
function fileSearchSubstance({ prompt, instruction, vectorStoreId }: FileSearchParameters): GenerateTextConfig | StreamTextConfig {
  const openai = getOpenaiProvider();
  const model = configManager.getConfig('openai:assistantModel:chat');
  return {
    prompt,
    model: openai(model),
    tools: {
      file_search: openai.tools.fileSearch({
        vectorStoreIds: [vectorStoreId],
        maxNumResults: 10,
        ranking: {
          ranker: 'auto',
        },
      }),
    },
    providerOptions: {
      openai: {
        store: true,
        instructions: instruction,
      },
    },
    // Force file search tool:
    toolChoice: { type: 'tool', toolName: 'file_search' },
  };
}

export const fileSearch = ({ prompt, instruction, vectorStoreId }: FileSearchParameters): GenerateTextResult => {
  return generateText(fileSearchSubstance({ prompt, instruction, vectorStoreId }));
};

export const fileSearchWithStream = ({ prompt, instruction, vectorStoreId }: FileSearchParameters): StreamTextResult => {
  return streamText(fileSearchSubstance({ prompt, instruction, vectorStoreId }));
};
