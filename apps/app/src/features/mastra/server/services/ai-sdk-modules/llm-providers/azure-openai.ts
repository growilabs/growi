import type { MastraModelConfig } from '@mastra/core/llm';

import { getApiKey, getProviderSettings } from './config';

// Microsoft Entra ID token scope for Azure Cognitive Services (matches the
// existing AzureOpenaiClientDelegator in features/openai).
const ENTRA_ID_SCOPE = 'https://cognitiveservices.azure.com/.default';

// Azure OpenAI is the one non-uniform provider: it is reached via a
// resource-specific endpoint (resourceName builds the standard
// `https://<name>.openai.azure.com/...` URL; baseURL is the escape hatch for
// sovereign clouds / API Management gateways / custom domains), and it can
// authenticate via either an API key or Microsoft Entra ID. All of that stays
// inside this resolver — the shared dispatch never sees it. The `modelId` here is
// the Azure *deployment name*, not an OpenAI model id, and is passed in by the
// caller (resolveMastraModel parses the effective modelKey and dispatches the bare
// modelId here).
//
// Connection settings live inside THIS provider's entry of `ai:providers`
// (getProviderSettings('azure-openai')?.azureOpenaiSettings; env var AI_PROVIDERS),
// and the API key comes from `getApiKey('azure-openai')` (env var
// AI_PROVIDER_API_KEYS). The object field is `baseURL`, matching the AI SDK's
// createAzure option (and the API/form use the same name end-to-end), so it passes
// straight through here.
//
// `@ai-sdk/azure` (and, only in the Entra ID path, `@azure/identity`) are loaded
// via dynamic import() so their module graphs are pulled ONLY when an Azure model
// is actually resolved — an instance configured for a different provider never pays
// that memory cost (see llm-providers/index.ts). Config validation runs BEFORE the
// imports so a misconfigured provider fails fast without loading either SDK, and
// `@azure/identity` is never loaded when API-key auth is used.
export const resolveAzureOpenaiModel = async (
  modelId: string,
): Promise<MastraModelConfig> => {
  // `?? {}` guards a missing azure-openai entry / malformed settings value (the
  // config accessor already fails soft to undefined on a malformed shape).
  const {
    resourceName,
    baseURL,
    apiVersion,
    useEntraId: useEntraIdRaw,
  } = getProviderSettings('azure-openai')?.azureOpenaiSettings ?? {};
  const useEntraId = useEntraIdRaw === true;

  // Endpoint is required regardless of the auth method. resourceName and baseURL
  // are mutually exclusive in the AI SDK — when both are set the SDK ignores
  // resourceName and uses baseURL — so passing both straight through is safe; we
  // only guard that at least one is present. apiVersion is likewise forwarded
  // as-is (undefined falls back to the SDK default). The throw names the missing
  // fields / the env var only — never an apiKey value.
  if (resourceName == null && baseURL == null) {
    throw new Error(
      'Azure OpenAI requires resourceName or baseURL to be set (via the admin AI settings or the AI_PROVIDERS environment variable)',
    );
  }

  if (useEntraId) {
    // Microsoft Entra ID (managed identity): resolve a bearer token from the
    // ambient Azure environment via DefaultAzureCredential. No API key is used.
    // `@azure/identity` is loaded only on this path.
    const [
      { createAzure },
      { DefaultAzureCredential, getBearerTokenProvider },
    ] = await Promise.all([import('@ai-sdk/azure'), import('@azure/identity')]);
    const tokenProvider = getBearerTokenProvider(
      new DefaultAzureCredential(),
      ENTRA_ID_SCOPE,
    );
    return createAzure({ tokenProvider, resourceName, baseURL, apiVersion })(
      modelId,
    );
  }

  // API-key auth: the key must be injected explicitly.
  const apiKey = getApiKey('azure-openai');
  if (apiKey == null) {
    throw new Error(
      'Azure OpenAI requires an API key (set it via the admin AI settings or the AI_PROVIDER_API_KEYS environment variable), or set "useEntraId": true to authenticate with Microsoft Entra ID',
    );
  }
  const { createAzure } = await import('@ai-sdk/azure');
  return createAzure({ apiKey, resourceName, baseURL, apiVersion })(modelId);
};
