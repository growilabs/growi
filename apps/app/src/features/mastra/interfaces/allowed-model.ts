import type { JSONValue } from 'ai';

import type { AiProvider } from './ai-provider';

/**
 * AI SDK providerOptions shape (provider namespace -> options). Declared in this
 * interfaces module (not server-side) so both the cross-layer DTOs and the server
 * resolver can reference one shape without importing server code. The single source
 * of truth for the providerOptions type across the feature.
 */
export type ModelProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * A single allowed model, identified by the (provider, modelId) pair: `provider`
 * is the model's owning provider (required — Req 2.1), and `modelId` is the model
 * ID within that provider (the deployment name for Azure OpenAI). The same
 * modelId may coexist under different providers (Req 2.3). `isDefault` marks
 * exactly one entry in the whole cross-provider allow-list as the global default.
 */
export interface AllowedModel {
  readonly provider: AiProvider;
  readonly modelId: string;
  readonly providerOptions?: ModelProviderOptions;
  readonly isDefault?: boolean;
}

/**
 * Whether the (provider, modelId) pair is present in the operator's allow-list.
 * The single membership rule, shared by the request-time resolver and the chat
 * selector seed (`get-models` route), so "what counts as an allowed model" cannot
 * drift between those call sites. Pure (no config access): callers pass the list
 * they already hold.
 */
export const isModelInAllowList = (
  provider: AiProvider,
  modelId: string,
  allowedModels: readonly AllowedModel[],
): boolean =>
  allowedModels.some((m) => m.provider === provider && m.modelId === modelId);
