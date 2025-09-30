import { generateText } from 'ai';

import { configManager } from '~/server/service/config-manager';

import { getOpenaiProvider } from './get-openai-provider';


type FileSearchParameters = {
  prompt: string;
  instruction: string;
  vectorStoreId: string;
};

export const fileSearch = async({ prompt, instruction, vectorStoreId }: FileSearchParameters) => {
  const openai = getOpenaiProvider();
  const model = configManager.getConfig('openai:assistantModel:chat');

  return generateText({
    prompt,
    system: instruction,
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
      },
    },
    // Force file search tool
    // see: https://ai-sdk.dev/providers/ai-sdk-providers/openai#file-search-tool
    toolChoice: { type: 'tool', toolName: 'file_search' },
  });
};
