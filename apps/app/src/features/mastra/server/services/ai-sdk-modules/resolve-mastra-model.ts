import type { MastraModelConfig } from '@mastra/core/llm';

import {
  isLlmProvider,
  LLM_PROVIDERS,
} from '~/features/mastra/interfaces/llm-provider';
import { configManager } from '~/server/service/config-manager';

import { llmModelFactories } from './llm-providers';

// Memoize the resolved model so the native provider object is built once and
// reused across calls. On misconfiguration the function throws (and does not
// memoize), mirroring the existing OpenaiClientDelegator constructor pattern:
// a config fix takes effect on the next call. Throwing — rather than returning
// a sentinel — is safe for app boot because the agent calls this lazily (its
// `model` is a function), so import-time construction never triggers it.
let memoizedModel: MastraModelConfig | undefined;

export const resolveMastraModel = (): MastraModelConfig => {
  if (memoizedModel != null) {
    return memoizedModel;
  }

  // `mastra:llmProvider` defaults to 'openai' and is typed as the provider union,
  // but env-loaded config is not runtime-validated against that type — an
  // out-of-union value (e.g. MASTRA_LLM_PROVIDER=azure) can still arrive — so we
  // re-validate here (Req 1.4).
  const provider = configManager.getConfig('mastra:llmProvider');
  if (!isLlmProvider(provider)) {
    throw new Error(
      `Unsupported Mastra LLM provider "${provider}" (expected one of: ${LLM_PROVIDERS.join(', ')})`,
    );
  }

  // The error message must never include the API key value (only its absence).
  const apiKey = configManager.getConfig('mastra:llmApiKey');
  if (apiKey == null) {
    throw new Error(
      `Mastra LLM API key is not configured for provider "${provider}" (set MASTRA_LLM_API_KEY)`,
    );
  }

  // `mastra:llmModel` carries a single default (tuned for the default provider).
  const model = configManager.getConfig('mastra:llmModel');

  memoizedModel = llmModelFactories[provider]({ apiKey, model });
  return memoizedModel;
};
