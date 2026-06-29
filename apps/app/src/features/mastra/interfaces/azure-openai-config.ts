/**
 * Azure OpenAI connection settings, persisted as a SINGLE JSON object under the
 * `ai:azureOpenaiSettings` config key (consolidated from the former four flat
 * `ai:azureOpenai{ResourceName,BaseUrl,ApiVersion,UseEntraId}` keys). Only
 * meaningful when `ai:provider` is 'azure-openai'.
 *
 * All fields are optional: Azure is reached via a resource-specific endpoint, so
 * exactly one of `resourceName` / `baseURL` is expected at resolve time (the AI
 * SDK treats them as mutually exclusive, preferring `baseURL`). `apiVersion` is
 * optional (the SDK defaults it). `useEntraId` selects Microsoft Entra ID
 * (managed identity) auth instead of an API key; absent / `false` means API-key
 * auth. None of these are secrets — only `ai:apiKey` is.
 *
 * `baseURL` (capital URL) matches the AI SDK's createAzure option name, and the
 * admin API and form reuse this same object, so `baseURL` is uniform end-to-end
 * (storage / API / form / SDK).
 *
 * Storage/loading: the DB value is the serialized object, and the
 * `AI_AZURE_OPENAI_SETTINGS` env var is a JSON string parsed by the config loader. The
 * key's `defaultValue` is an object (`{}`) so the loader parses the env var as
 * JSON; a malformed env var fails soft to `null`, so consumers must treat the
 * resolved value defensively (`?? {}`).
 */
export interface AzureOpenaiConfig {
  resourceName?: string;
  baseURL?: string;
  apiVersion?: string;
  useEntraId?: boolean;
}
