/**
 * Azure OpenAI connection settings, held as the `azureOpenaiSettings` object of
 * the `azure-openai` entry inside the multi-provider `ai:providers` config
 * (`AiProviderSettings.azureOpenaiSettings`). Only meaningful for that provider
 * entry.
 *
 * All fields are optional: Azure is reached via a resource-specific endpoint, so
 * exactly one of `resourceName` / `baseURL` is expected at resolve time (the AI
 * SDK treats them as mutually exclusive, preferring `baseURL`). `apiVersion` is
 * optional (the SDK defaults it). `useEntraId` selects Microsoft Entra ID
 * (managed identity) auth instead of an API key; absent / `false` means API-key
 * auth. None of these are secrets — the API key lives separately in
 * `ai:providerApiKeys` (the only isSecret AI config key).
 *
 * `baseURL` (capital URL) matches the AI SDK's createAzure option name, and the
 * admin API and form reuse this same object, so `baseURL` is uniform end-to-end
 * (storage / API / form / SDK).
 */
export interface AzureOpenaiConfig {
  resourceName?: string;
  baseURL?: string;
  apiVersion?: string;
  useEntraId?: boolean;
}
