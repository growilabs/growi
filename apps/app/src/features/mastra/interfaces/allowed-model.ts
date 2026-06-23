import type { JSONValue } from 'ai';

/**
 * AI SDK providerOptions shape (provider namespace -> options). Declared in this
 * interfaces module (not server-side) so both the cross-layer DTOs and the server
 * resolver can reference one shape without importing server code. The single source
 * of truth for the providerOptions type across the feature.
 */
export type ModelProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * A single allowed model. `modelId` is the model ID (the deployment name for Azure
 * OpenAI). `isDefault` marks exactly one entry in the allow-list as the default.
 */
export interface AllowedModel {
  readonly modelId: string;
  readonly providerOptions?: ModelProviderOptions;
  readonly isDefault?: boolean;
}

/**
 * Whether `modelId` is present in the operator's allow-list. The single membership
 * rule, shared by the request-time resolver (`resolveEffectiveModelId`) and the chat
 * selector seed (`get-models` route), so "what counts as an allowed model" cannot
 * drift between those call sites. Pure (no config access): callers pass the list
 * they already hold.
 */
export const isModelInAllowList = (
  modelId: string,
  allowedModels: readonly AllowedModel[],
): boolean => allowedModels.some((m) => m.modelId === modelId);
