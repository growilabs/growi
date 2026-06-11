import type { MastraModelConfig } from '@mastra/core/llm';

import type { LlmProvider } from '~/features/mastra/interfaces/llm-provider';

import { createAnthropicModel } from './anthropic';
import { createGoogleModel } from './google';
import { createOpenAiModel } from './openai';

// Factories return MastraModelConfig (the type @mastra/core's Agent.model
// accepts), not `ai`'s broad LanguageModel union — the latter also includes a
// bare model-id string form that is not assignable to MastraModelConfig. The
// concrete provider objects these factories build ARE valid MastraModelConfig
// members, so the whole pipeline stays cast-free.
export type LlmModelFactory = (params: {
  apiKey: string;
  model: string;
}) => MastraModelConfig;

// Data-driven provider -> factory map. Consumers select by provider key and must
// not branch on the provider name. Adding a provider requires only a new entry here
// plus the corresponding LlmProvider union member.
export const llmModelFactories: Record<LlmProvider, LlmModelFactory> = {
  openai: createOpenAiModel,
  anthropic: createAnthropicModel,
  google: createGoogleModel,
};
