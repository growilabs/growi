import type { JSONValue } from 'ai';

/**
 * AI SDK providerOptions shape (provider namespace -> options). Same shape as the
 * server-side MastraProviderOptions; declared here so the cross-layer DTOs can
 * reference it without importing server code.
 */
export type ModelProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * A single allowed model. `model` is the model ID (the deployment name for Azure
 * OpenAI). `isDefault` marks exactly one entry in the allow-list as the default.
 */
export interface AllowedModel {
  readonly model: string;
  readonly providerOptions?: ModelProviderOptions;
  readonly isDefault?: boolean;
}
