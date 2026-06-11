import { createAzure } from '@ai-sdk/azure';
import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from '@azure/identity';
import type { MastraModelConfig } from '@mastra/core/llm';

// Azure OpenAI needs more than { apiKey, model }: it is reached via a
// resource-specific endpoint. `resourceName` builds the standard
// `https://<resourceName>.openai.azure.com/...` URL; `baseURL` is the escape
// hatch for sovereign clouds (Azure Government etc.) / API Management gateways /
// custom domains. The AI SDK accepts exactly one of them (baseURL wins when both
// are set). `apiVersion` is optional (the SDK applies its own default).
//
// `useEntraId` switches authentication from an API key to Microsoft Entra ID
// (managed identity via DefaultAzureCredential); in that mode no apiKey is used.
export type AzureOpenaiProviderConfig = {
  readonly resourceName?: string;
  readonly baseURL?: string;
  readonly apiVersion?: string;
  readonly useEntraId?: boolean;
};

// Microsoft Entra ID token scope for Azure Cognitive Services (matches the
// existing AzureOpenaiClientDelegator in features/openai).
const ENTRA_ID_SCOPE = 'https://cognitiveservices.azure.com/.default';

// Thin adapter: create the native Azure OpenAI provider with an explicitly
// injected credential (never relying on the provider's process.env
// auto-detection for the API key) and apply the model. For Azure, `model` is the
// *deployment name* the operator created on their resource, not an OpenAI model id.
export const createAzureOpenaiModel = (params: {
  apiKey?: string;
  model: string;
  azureOpenai?: AzureOpenaiProviderConfig;
}): MastraModelConfig => {
  const { apiKey, model, azureOpenai } = params;
  const resourceName = azureOpenai?.resourceName;
  const baseURL = azureOpenai?.baseURL;
  const apiVersion = azureOpenai?.apiVersion;
  const useEntraId = azureOpenai?.useEntraId === true;

  // Endpoint is required regardless of the auth method. Validated here (not in
  // the resolver) so the resolver stays free of provider-name branching. The
  // throw surfaces at use time and is handled by post-message's try/catch. The
  // message names the missing env vars only — never a credential.
  if (resourceName == null && baseURL == null) {
    throw new Error(
      'Azure OpenAI requires MASTRA_LLM_AZURE_OPENAI_RESOURCE_NAME or MASTRA_LLM_AZURE_OPENAI_BASE_URL to be set',
    );
  }

  // resourceName and baseURL are mutually exclusive in the AI SDK (baseURL wins
  // when both are set), so pass only one. apiVersion is forwarded only when set
  // so the SDK default applies otherwise.
  const endpoint = baseURL != null ? { baseURL } : { resourceName };
  const apiVersionOption = apiVersion != null ? { apiVersion } : {};

  if (useEntraId) {
    // Microsoft Entra ID auth: resolve a bearer token from the ambient Azure
    // environment (managed identity / env / az CLI) via DefaultAzureCredential.
    // No API key is used in this mode.
    const tokenProvider = getBearerTokenProvider(
      new DefaultAzureCredential(),
      ENTRA_ID_SCOPE,
    );
    return createAzure({ tokenProvider, ...endpoint, ...apiVersionOption })(
      model,
    );
  }

  // API-key auth: the key must be injected explicitly (the resolver normally
  // enforces this, but guard here too since the factory's apiKey is optional to
  // accommodate the Entra ID path).
  if (apiKey == null) {
    throw new Error(
      'Azure OpenAI requires MASTRA_LLM_API_KEY, or set MASTRA_LLM_AZURE_OPENAI_USE_ENTRA_ID=true to authenticate with Microsoft Entra ID',
    );
  }

  return createAzure({ apiKey, ...endpoint, ...apiVersionOption })(model);
};
