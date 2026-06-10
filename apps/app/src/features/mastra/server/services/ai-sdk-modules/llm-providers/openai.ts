import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

// Thin adapter: create the native OpenAI provider with an explicitly injected
// API key (never relying on the provider's process.env auto-detection) and
// apply the model id. See get-openai-provider.ts for the original pattern.
export const createOpenAiModel = (params: {
  apiKey: string;
  model: string;
}): LanguageModel => {
  const { apiKey, model } = params;
  return createOpenAI({ apiKey })(model);
};
