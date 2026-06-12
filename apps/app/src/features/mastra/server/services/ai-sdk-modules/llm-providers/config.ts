import { configManager } from '~/server/service/config-manager';

// Shared config accessors for the per-provider model resolvers. The two keys
// below are common to every provider, so reading them lives here (symmetrically)
// rather than in any single provider module. Provider-specific keys (e.g. the
// Azure endpoint) are read inside that provider's own resolver.

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

// Model is required (no default). For the azure-openai provider this value is
// the Azure deployment name. The message never includes a secret.
export const requireModel = (): string => {
  const model = configManager.getConfig('ai:model');
  if (model == null) {
    throw new Error('Mastra LLM model is not configured (set AI_MODEL)');
  }
  return model;
};
