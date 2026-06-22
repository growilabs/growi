import type { JSONValue } from 'ai';

import {
  getAllowedModels,
  resolveEffectiveModel,
} from './llm-providers/config';

// AI SDK `providerOptions` shape: provider namespace -> option map. Operators
// supply the full, provider-namespaced object as JSON per allowed-model entry, so
// this feature carries no per-vendor mapping logic. Same shape as the cross-layer
// ModelProviderOptions DTO.
export type MastraProviderOptions = Record<string, Record<string, JSONValue>>;

// Resolve the provider options for the mastra chat stream call from the EFFECTIVE
// model's allow-list entry. There is no global, uniformly-applied options value
// (Req 2.5): options are always resolved per used model.
//
// resolveEffectiveModel collapses an out-of-allowlist / omitted modelId to the
// default, so a rejected client value yields the DEFAULT model's options — never
// the requested-but-disallowed model's (Req 4.4). It throws on an empty allow-list
// (AI unconfigured), which is the established invariant; callers only reach here
// once AI is configured. Returns {} when the resolved entry has no options.
export const resolveProviderOptions = (
  modelId?: string,
): MastraProviderOptions => {
  const effective = resolveEffectiveModel(modelId);
  const entry = getAllowedModels().find((m) => m.model === effective);
  return entry?.providerOptions ?? {};
};
