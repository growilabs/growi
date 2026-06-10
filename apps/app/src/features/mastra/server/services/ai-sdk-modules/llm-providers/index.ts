import type { LanguageModel } from 'ai';

import type { LlmVendor } from '~/features/mastra/interfaces/llm-vendor';

import { createAnthropicModel } from './anthropic';
import { createGoogleModel } from './google';
import { createOpenAiModel } from './openai';

export type LlmModelFactory = (params: {
  apiKey: string;
  model: string;
}) => LanguageModel;

// Data-driven vendor -> factory map. Consumers select by vendor key and must
// not branch on the vendor name. Adding a vendor requires only a new entry here
// plus the corresponding LlmVendor union member.
export const llmModelFactories: Record<LlmVendor, LlmModelFactory> = {
  openai: createOpenAiModel,
  anthropic: createAnthropicModel,
  google: createGoogleModel,
};
