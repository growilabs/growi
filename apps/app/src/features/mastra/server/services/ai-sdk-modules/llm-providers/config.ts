import {
  type AllowedModel,
  isModelInAllowList,
} from '~/features/mastra/interfaces/allowed-model';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:features:mastra:llm-providers:config');

// Shared config accessors for the per-provider model resolvers. The api key is
// common to every provider, so reading it lives here (symmetrically) rather than
// in any single provider module. Provider-specific keys (e.g. the Azure endpoint)
// are read inside that provider's own resolver.

export const getApiKey = (): string | undefined =>
  configManager.getConfig('ai:apiKey');

// API key is mandatory for the key-based providers. The message never includes
// the key value (only its absence).
export const requireApiKey = (): string => {
  const apiKey = getApiKey();
  if (apiKey == null) {
    throw new Error('Mastra LLM API key is not configured (set AI_API_KEY)');
  }
  return apiKey;
};

// The allow-list of models the operator permits. Returns it verbatim (falling
// back to []); never synthesises entries or migrates from the removed single
// ai:model / ai:providerOptions keys.
//
// Array.isArray (not `?? []`) because the AllowedModel[] type is a compile-time
// annotation only — config-manager does not runtime-validate values (the loader
// JSON-parses the env var and casts the result unchecked), so getConfig can hand
// back any JSON value (e.g. an object) that the AllowedModel[] type denies. The
// guard makes the runtime value honour its declared type. We coerce to [] rather
// than throw because this accessor feeds isAiConfigured(), which must return a
// boolean: a malformed value reads as [] = AI unconfigured (fail soft) instead of
// throwing out of a should-be-pure predicate.
export const getAllowedModels = (): AllowedModel[] => {
  const allowedModels = configManager.getConfig('ai:allowedModels');
  return Array.isArray(allowedModels) ? allowedModels : [];
};

// The default model id: the entry flagged isDefault, else the first entry, else
// undefined when the allow-list is empty. The find()?? first fallback is also a
// defensive guard against a malformed saved value (manual DB edit / direct env)
// that the PUT validator would otherwise reject.
export const getDefaultModelId = (): string | undefined => {
  const models = getAllowedModels();
  return models.find((m) => m.isDefault)?.modelId ?? models[0]?.modelId;
};

// Resolve the effective model id used for a chat request. This is the single
// server-side security checkpoint that validates the client-supplied modelId
// against the allow-list (the client value is never trusted):
//   - modelId in the allow-list  -> use it
//   - modelId out of allow-list  -> fall back to the default (warn, model id only)
//   - modelId omitted            -> use the default
//   - allow-list empty           -> throw (AI is unconfigured)
export const resolveEffectiveModelId = (modelId?: string): string => {
  const models = getAllowedModels();
  if (models.length === 0) {
    throw new Error(
      'No allowed models are configured (set AI_ALLOWED_MODELS / ai:allowedModels)',
    );
  }

  if (modelId != null && isModelInAllowList(modelId, models)) {
    return modelId;
  }

  // Non-empty allow-list guarantees a default model id here.
  const defaultModelId = getDefaultModelId() as string;

  if (modelId != null) {
    // Audit out-of-allowlist fallback. Log the model id only — no secrets.
    logger.warn(
      `Requested model "${modelId}" is not in the allow-list; falling back to the default model`,
    );
  }

  return defaultModelId;
};
