import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

// Thin adapter: create the native Anthropic provider with an explicitly
// injected API key (never relying on the provider's process.env auto-detection)
// and apply the model id.
export const createAnthropicModel = (params: {
  apiKey: string;
  model: string;
}): LanguageModel => {
  const { apiKey, model } = params;
  return createAnthropic({ apiKey })(model);
};
