import { createAzure } from '@ai-sdk/azure';
import type { MastraModelConfig } from '@mastra/core/llm';

// Azure OpenAI needs more than { apiKey, model }: it is reached via a
// resource-specific endpoint. `resourceName` builds the standard
// `https://<resourceName>.openai.azure.com/...` URL; `baseURL` is the escape
// hatch for sovereign clouds (Azure Government etc.) / API Management gateways /
// custom domains. The AI SDK accepts exactly one of them (baseURL wins when both
// are set). `apiVersion` is optional (the SDK applies its own default).
export type AzureOpenaiProviderConfig = {
  readonly resourceName?: string;
  readonly baseURL?: string;
  readonly apiVersion?: string;
};

// Thin adapter: create the native Azure OpenAI provider with an explicitly
// injected API key (never relying on the provider's process.env auto-detection)
// and apply the model. For Azure, `model` is the *deployment name* the operator
// created on their resource, not an OpenAI model id.
export const createAzureOpenaiModel = (params: {
  apiKey: string;
  model: string;
  azureOpenai?: AzureOpenaiProviderConfig;
}): MastraModelConfig => {
  const { apiKey, model, azureOpenai } = params;
  const resourceName = azureOpenai?.resourceName;
  const baseURL = azureOpenai?.baseURL;
  const apiVersion = azureOpenai?.apiVersion;

  // Azure-specific required config is validated here (not in the resolver) so
  // the resolver stays free of provider-name branching. The throw surfaces at
  // use time and is handled by post-message's try/catch, like every other
  // misconfiguration. The message names the missing env vars only — never a key.
  if (resourceName == null && baseURL == null) {
    throw new Error(
      'Azure OpenAI requires MASTRA_LLM_AZURE_OPENAI_RESOURCE_NAME or MASTRA_LLM_AZURE_OPENAI_BASE_URL to be set',
    );
  }

  // resourceName and baseURL are mutually exclusive in the AI SDK (baseURL wins
  // when both are set), so pass only one. apiVersion is forwarded only when set
  // so the SDK default applies otherwise.
  const endpoint = baseURL != null ? { baseURL } : { resourceName };

  return createAzure({
    apiKey,
    ...endpoint,
    ...(apiVersion != null ? { apiVersion } : {}),
  })(model);
};
