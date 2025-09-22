import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai';

import { configManager } from '~/server/service/config-manager';

import { isAiEnabled } from '../../is-ai-enabled';


let instance: OpenAIProvider;

export const getOpenaiProvider = (): OpenAIProvider => {
  if (instance != null) {
    return instance;
  }

  const openaiApiKey = configManager.getConfig('openai:apiKey');
  if (!isAiEnabled() || openaiApiKey == null) {
    throw new Error('GROWI AI is not enabled');
  }

  // Not using import { openai } from '@ai-sdk/openai' since we want to explicitly set the API key, we'll use createOpenAI instead
  // See: https://ai-sdk.dev/providers/ai-sdk-providers/openai#provider-instance
  instance = createOpenAI({
    apiKey: openaiApiKey,
  });

  return instance;
};
