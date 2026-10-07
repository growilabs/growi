import type { ModelProviderOptions } from '~/features/mastra/interfaces/allowed-model';
import { getEffectiveDefaultModelKey } from '~/features/mastra/server/services/ai-sdk-modules/llm-providers/effective-model-key';
import { getProviderOptionsForModel } from '~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options';
import { configManager } from '~/server/service/config-manager';

/**
 * Merge two providerOptions records namespace by namespace — a depth-2 merge
 * matching the declared shape of ModelProviderOptions (provider namespace ->
 * option name -> value). Within a namespace the overlay wins per option;
 * option VALUES are replaced whole, never merged deeper: a provider option
 * (e.g. anthropic's `thinking` object) is one self-contained setting, and
 * merging inside it could produce fragments no provider accepts.
 */
const mergeProviderOptions = (
  base: ModelProviderOptions,
  overlay: ModelProviderOptions,
): ModelProviderOptions => {
  const merged = { ...base };
  for (const [namespace, options] of Object.entries(overlay)) {
    merged[namespace] = { ...merged[namespace], ...options };
  }
  return merged;
};

/**
 * Resolve the providerOptions for the suggestPathAgent generate call.
 *
 * Base: the catalog-declared providerOptions of the effective model — the
 * same per-model source the chat route uses (getProviderOptionsForModel).
 * The agent resolves its model with `resolveMastraModel()` (no explicit key),
 * so the effective key here is the allow-list default; both lookups go
 * through the same allow-list checkpoint and cannot diverge.
 *
 * Overlay: the suggest-path-specific providerOptions
 * (`ai:providerOptions:suggestPathAgent`), read per request so a config
 * change takes effect without a server restart. null means "unset": the
 * catalog options pass through unchanged. The overlay is provider-agnostic —
 * the same provider-namespaced shape as the catalog — because reasoning
 * controls differ per provider (`openai.reasoningEffort`,
 * `anthropic.thinking`, `google.thinkingConfig`); operators express the
 * override under the matching provider namespace. Namespaces other than the
 * effective model's owning provider pass through and are ignored by the AI
 * SDK, exactly like catalog-declared options, so overrides for several
 * providers may be pre-declared and survive a model switch.
 *
 * Option validity per model is the provider's concern, not enforced here —
 * an unsupported combination surfaces as a provider error and is absorbed by
 * the orchestrator's memo fallback (design.md AgenticEngine, 3.5/3.6).
 */
export const resolveAgentProviderOptions = (): ModelProviderOptions => {
  const effectiveModelKey = getEffectiveDefaultModelKey();
  const baseOptions = getProviderOptionsForModel(effectiveModelKey);

  const overlay = configManager.getConfig(
    'ai:providerOptions:suggestPathAgent',
  );
  if (overlay == null) {
    return baseOptions;
  }

  return mergeProviderOptions(baseOptions, overlay);
};
