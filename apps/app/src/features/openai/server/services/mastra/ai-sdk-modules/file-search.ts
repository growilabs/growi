import { streamText, generateText } from 'ai';

import { configManager } from '~/server/service/config-manager';

import type {
  GenerateTextConfig, StreamTextConfig, GenerateTextResult, StreamTextResult,
} from '../../../../interfaces/ai-sdk';

import { getOpenaiProvider } from './get-openai-provider';


type FileSearchParameters = {
  prompt: string,
  instruction: string,
  vectorStoreId: string,
}

function fileSearchSubstance(params: FileSearchParameters): GenerateTextConfig;
function fileSearchSubstance(params: FileSearchParameters): StreamTextConfig;
function fileSearchSubstance({ prompt, instruction, vectorStoreId }: FileSearchParameters): GenerateTextConfig | StreamTextConfig {
  const openai = getOpenaiProvider();
  const model = configManager.getConfig('openai:assistantModel:chat');
  return {
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
  };
}


// for Agent tool
export const fileSearch = ({ prompt, instruction, vectorStoreId }: FileSearchParameters): GenerateTextResult => {
  return generateText(fileSearchSubstance({ prompt, instruction, vectorStoreId }));
};

// for Workflow step
export const fileSearchWithStream = ({ prompt, instruction, vectorStoreId }: FileSearchParameters): StreamTextResult => {
  return streamText(fileSearchSubstance({ prompt, instruction, vectorStoreId }));
};
