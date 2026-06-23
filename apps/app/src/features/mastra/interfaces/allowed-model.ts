import type { JSONValue } from 'ai';

/**
 * AI SDK providerOptions shape (provider namespace -> options). Declared in this
 * interfaces module (not server-side) so both the cross-layer DTOs and the server
 * resolver can reference one shape without importing server code. The single source
 * of truth for the providerOptions type across the feature.
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
