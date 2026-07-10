import type { AiProvider } from '../../../interfaces/ai-provider';
import { getEffectiveModelPicker } from './effective-model-catalog';

/**
 * A resolver that maps a (provider, modelId) pair to its official display name.
 * Returned by {@link buildModelDisplayNameResolver}.
 */
export type ModelDisplayNameResolver = (
  provider: AiProvider,
  modelId: string,
) => string;

/**
 * Build a (provider, modelId) → display name resolver over the EFFECTIVE catalog.
 *
 * The operator's allow-list (config) stores only ids; the display name lives in
 * the catalog. This joins the two: it resolves the effective catalog ONCE (a
 * single persisted-singleton read, shared across every provider), then resolves
 * a name for a known id, or falls back to the `modelId` itself (catalog-less
 * providers such as azure-openai, operator free-text, or ids models.dev has
 * since removed) — so a display name always exists. Shared by the chat model
 * list (get-models) and the admin settings (get-ai-settings) so "how a model is
 * named" cannot drift between them.
 */
export const buildModelDisplayNameResolver = async (
  providers: readonly AiProvider[],
): Promise<ModelDisplayNameResolver> => {
  const distinctProviders = [...new Set(providers)];

  // One effective-catalog read for the whole allow-list; the returned picker
  // then resolves each provider synchronously from that single result.
  const pick = await getEffectiveModelPicker();

  const nameMaps = new Map<AiProvider, Map<string, string>>();
  for (const provider of distinctProviders) {
    nameMaps.set(provider, new Map(pick(provider).map((e) => [e.id, e.name])));
  }

  return (provider, modelId) => nameMaps.get(provider)?.get(modelId) ?? modelId;
};
