import type { ModelProviderOptions } from '~/features/mastra/interfaces/allowed-model';
import { resolveEffectiveModelId } from '~/features/mastra/server/services/ai-sdk-modules/llm-providers/config';
import { getProviderOptionsForModel } from '~/features/mastra/server/services/ai-sdk-modules/resolve-provider-options';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:ai-tools:suggest-path:agentic-provider-options',
);

// Providers whose AI SDK language models read the `openai` providerOptions
// namespace: @ai-sdk/azure reuses the OpenAI language-model implementation,
// so both accept `openai.reasoningEffort`.
const OPENAI_FAMILY_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'azure-openai',
]);

/**
 * Resolve the providerOptions for the suggestPathAgent generate call.
 *
 * Base: the catalog-declared providerOptions of the effective model — the
 * same per-model source the chat route uses (getProviderOptionsForModel).
 * The agent resolves its model with `resolveMastraModel()` (no explicit id),
 * so the effective id here is the allow-list default; both lookups go
 * through the same allow-list checkpoint and cannot diverge.
 *
 * Overlay: the suggest-path-specific reasoning effort
 * (`openai:reasoningEffort:suggestPathAgent`), read per request so a config
 * change takes effect without a server restart. Empty means "unset": the
 * catalog options pass through unchanged. The knob is OpenAI-specific (its
 * config key / env var name say so, and other providers express reasoning
 * controls with different option shapes), so when the active provider is not
 * in the OpenAI family the configured value is skipped WITH a warning —
 * never silently ignored.
 */
export const resolveAgentProviderOptions = (): ModelProviderOptions => {
  const effectiveModelId = resolveEffectiveModelId();
  const baseOptions = getProviderOptionsForModel(effectiveModelId);

  const reasoningEffort = configManager.getConfig(
    'openai:reasoningEffort:suggestPathAgent',
  );
  if (reasoningEffort === '') {
    return baseOptions;
  }

  const provider = configManager.getConfig('ai:provider');
  if (typeof provider !== 'string' || !OPENAI_FAMILY_PROVIDERS.has(provider)) {
    logger.warn(
      `openai:reasoningEffort:suggestPathAgent is configured but the active AI provider "${provider}" is not OpenAI-compatible; the setting is ignored`,
    );
    return baseOptions;
  }

  // Value validity per model is the provider's concern, not enforced here —
  // an unsupported combination surfaces as a provider error and is absorbed
  // by the orchestrator's memo fallback (design.md AgenticEngine, 3.5/3.6).
  return {
    ...baseOptions,
    openai: { ...baseOptions.openai, reasoningEffort },
  };
};
