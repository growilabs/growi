import { createAzure } from '@ai-sdk/azure';
import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from '@azure/identity';
import type { MastraModelConfig } from '@mastra/core/llm';

import { configManager } from '~/server/service/config-manager';

import { getApiKey, requireModel } from './config';

// Microsoft Entra ID token scope for Azure Cognitive Services (matches the
// existing AzureOpenaiClientDelegator in features/openai).
const ENTRA_ID_SCOPE = 'https://cognitiveservices.azure.com/.default';

// Azure OpenAI is the one non-uniform provider: it is reached via a
// resource-specific endpoint (resourceName builds the standard
// `https://<name>.openai.azure.com/...` URL; baseURL is the escape hatch for
// sovereign clouds / API Management gateways / custom domains), and it can
// authenticate via either an API key or Microsoft Entra ID. All of that stays
// inside this resolver — the shared dispatch never sees it. `ai:model`
// here is the Azure *deployment name*, not an OpenAI model id.
export const resolveAzureOpenaiModel = (): MastraModelConfig => {
  const resourceName = configManager.getConfig('ai:azureOpenaiResourceName');
  const baseURL = configManager.getConfig('ai:azureOpenaiBaseUrl');
  const apiVersion = configManager.getConfig('ai:azureOpenaiApiVersion');
  const useEntraId =
    configManager.getConfig('ai:azureOpenaiUseEntraId') === true;
  const model = requireModel();

  // Endpoint is required regardless of the auth method. resourceName and baseURL
  // are mutually exclusive in the AI SDK — when both are set the SDK ignores
  // resourceName and uses baseURL — so passing both straight through is safe; we
  // only guard that at least one is present. apiVersion is likewise forwarded
  // as-is (undefined falls back to the SDK default). The throw names the missing
  // env vars only — never a key.
  if (resourceName == null && baseURL == null) {
    throw new Error(
      'Azure OpenAI requires AI_AZURE_OPENAI_RESOURCE_NAME or AI_AZURE_OPENAI_BASE_URL to be set',
    );
  }

  if (useEntraId) {
    // Microsoft Entra ID (managed identity): resolve a bearer token from the
    // ambient Azure environment via DefaultAzureCredential. No API key is used.
    const tokenProvider = getBearerTokenProvider(
      new DefaultAzureCredential(),
      ENTRA_ID_SCOPE,
    );
    return createAzure({ tokenProvider, resourceName, baseURL, apiVersion })(
      model,
    );
  }

  // API-key auth: the key must be injected explicitly.
  const apiKey = getApiKey();
  if (apiKey == null) {
    throw new Error(
      'Azure OpenAI requires AI_API_KEY, or set AI_AZURE_OPENAI_USE_ENTRA_ID=true to authenticate with Microsoft Entra ID',
    );
  }
  return createAzure({ apiKey, resourceName, baseURL, apiVersion })(model);
};
