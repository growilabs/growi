import type { MastraModelConfig } from '@mastra/core/llm';

import {
  isLlmProvider,
  LLM_PROVIDERS,
} from '~/features/mastra/interfaces/llm-provider';
import { configManager } from '~/server/service/config-manager';

import { buildLlmModel } from './llm-providers';

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

  // Azure OpenAI can authenticate via Microsoft Entra ID (managed identity)
  // instead of an API key. This flag is the single signal that an alternative
  // credential is configured; the resolver branches on it (config presence), not
  // on the provider name. It is meaningless for non-Azure providers (default
  // false), so their API-key requirement below is unaffected.
  const useEntraId =
    configManager.getConfig('mastra:llmAzureOpenaiUseEntraId') === true;

  // An API key is required UNLESS an alternative credential (Entra ID) is in
  // use. The message must never include the API key value (only its absence).
  const apiKey = configManager.getConfig('mastra:llmApiKey');
  if (apiKey == null && !useEntraId) {
    throw new Error(
      `Mastra LLM API key is not configured for provider "${provider}" (set MASTRA_LLM_API_KEY)`,
    );
  }

  // `mastra:llmModel` carries a single default (tuned for the default provider).
  // For the 'azure-openai' provider this value is the Azure *deployment name*.
  const model = configManager.getConfig('mastra:llmModel');

  // Azure-OpenAI-only connection config. Forwarded to the factory ONLY when at
  // least one value is set, so other providers keep receiving exactly
  // { apiKey, model } (and so this resolver does not branch on the provider
  // name — it branches on config presence, which is data-driven). The
  // azure-openai factory validates these and throws if neither resourceName nor
  // baseURL is set; that throw surfaces here at use time (not memoized) and is
  // handled by the post-message route's try/catch.
  const azureOpenaiResourceName = configManager.getConfig(
    'mastra:llmAzureOpenaiResourceName',
  );
  const azureOpenaiBaseUrl = configManager.getConfig(
    'mastra:llmAzureOpenaiBaseUrl',
  );
  const azureOpenaiApiVersion = configManager.getConfig(
    'mastra:llmAzureOpenaiApiVersion',
  );
  const azureOpenai =
    azureOpenaiResourceName != null ||
    azureOpenaiBaseUrl != null ||
    azureOpenaiApiVersion != null ||
    useEntraId
      ? {
          resourceName: azureOpenaiResourceName,
          baseURL: azureOpenaiBaseUrl,
          apiVersion: azureOpenaiApiVersion,
          // Only carry the flag when enabled, so the API-key path's call shape
          // stays minimal (and existing assertions on it are unaffected).
          ...(useEntraId ? { useEntraId: true } : {}),
        }
      : undefined;

  memoizedModel = buildLlmModel(provider, {
    apiKey,
    model,
    ...(azureOpenai != null ? { azureOpenai } : {}),
  });
  return memoizedModel;
};
