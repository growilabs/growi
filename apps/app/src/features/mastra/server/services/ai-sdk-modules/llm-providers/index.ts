import type { MastraModelConfig } from '@mastra/core/llm';

import type { LlmProvider } from '~/features/mastra/interfaces/llm-provider';

import { createAnthropicModel } from './anthropic';
import {
  type AzureOpenaiProviderConfig,
  createAzureOpenaiModel,
} from './azure-openai';
import { createGoogleModel } from './google';
import { createOpenAiModel } from './openai';

// Per-provider factory params. Each provider declares exactly what it needs, so
// the requirement is expressed in the type — no runtime apiKey guard:
//   - key-based providers (openai/anthropic/google) REQUIRE `apiKey`.
//   - azure-openai makes `apiKey` OPTIONAL (it can authenticate via Microsoft
//     Entra ID instead) and additionally takes endpoint config.
// Factories return MastraModelConfig (the type @mastra/core's Agent.model
// accepts), not `ai`'s broad LanguageModel union; the concrete provider objects
// they build ARE valid MastraModelConfig members, so the pipeline stays cast-free.
type ApiKeyFactoryParams = { apiKey: string; model: string };
type AzureOpenaiFactoryParams = {
  apiKey?: string;
  model: string;
  azureOpenai?: AzureOpenaiProviderConfig;
};

export type LlmModelFactoryParams = {
  openai: ApiKeyFactoryParams;
  anthropic: ApiKeyFactoryParams;
  google: ApiKeyFactoryParams;
  'azure-openai': AzureOpenaiFactoryParams;
};

// Data-driven provider -> factory map, each entry typed with its own params
// (homomorphic mapped type preserves the per-provider signature). Adding a
// provider requires a new entry here, its params above, and the LlmProvider
// union member.
const llmModelFactories: {
  [P in LlmProvider]: (params: LlmModelFactoryParams[P]) => MastraModelConfig;
} = {
  openai: createOpenAiModel,
  anthropic: createAnthropicModel,
  google: createGoogleModel,
  'azure-openai': createAzureOpenaiModel,
};

// Generic dispatch that keeps the (provider, params) correlation: indexing both
// the factory map and the params type by the same `P` lets the call type-check
// without branching on the provider name and without a cast. Consumers (the
// resolver) call this instead of reaching into the map, so the per-provider
// param contract is enforced at the boundary.
export const buildLlmModel = <P extends LlmProvider>(
  provider: P,
  params: LlmModelFactoryParams[P],
): MastraModelConfig => llmModelFactories[provider](params);

// Re-exported for completeness assertions (every provider has a factory).
export { llmModelFactories };
