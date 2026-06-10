import type { MastraModelConfig } from '@mastra/core/llm';

import type { LlmVendor } from '~/features/mastra/interfaces/llm-vendor';
import {
  isLlmVendor,
  LLM_VENDORS,
} from '~/features/mastra/interfaces/llm-vendor';
import { configManager } from '~/server/service/config-manager';

import { llmModelFactories } from './llm-providers';

// Per-vendor default model, applied when `mastra:llmModel` is unset. Provisional
// current-generation defaults; finalize against each provider's current models.
const defaultModels = {
  openai: 'o4-mini',
  anthropic: 'claude-sonnet-4-5',
  google: 'gemini-2.5-flash',
} as const satisfies Record<LlmVendor, string>;

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

  const vendor = configManager.getConfig('mastra:llmVendor');
  if (vendor == null) {
    throw new Error(
      'Mastra LLM vendor is not configured (set MASTRA_LLM_VENDOR)',
    );
  }
  if (!isLlmVendor(vendor)) {
    throw new Error(
      `Unsupported Mastra LLM vendor "${vendor}" (expected one of: ${LLM_VENDORS.join(', ')})`,
    );
  }

  // The error message must never include the API key value (only its absence).
  const apiKey = configManager.getConfig('mastra:llmApiKey');
  if (apiKey == null) {
    throw new Error(
      `Mastra LLM API key is not configured for vendor "${vendor}" (set MASTRA_LLM_API_KEY)`,
    );
  }

  // Unset -> per-vendor default model.
  const model =
    configManager.getConfig('mastra:llmModel') ?? defaultModels[vendor];

  memoizedModel = llmModelFactories[vendor]({ apiKey, model });
  return memoizedModel;
};
