import type { AiProvider } from '~/features/mastra/interfaces/ai-provider';
import { isAiProvider } from '~/features/mastra/interfaces/ai-provider';
import { isAiEnabled } from '~/features/openai/server/services';
import { configManager } from '~/server/service/config-manager';

import {
  getAllowedModels,
  getApiKey,
} from './ai-sdk-modules/llm-providers/config';

// "Is AI configured?" requires all three independent prerequisites to hold:
//   1. a supported provider is selected (`ai:provider` passes isAiProvider),
//   2. the provider's required connection config is present (see
//      hasRequiredProviderConfig — credentials, plus the Azure endpoint),
//   3. the operator's allow-list has at least one model.
// The allow-list check replaces the former single ai:model presence test:
// "no allowed models" is always observed as getAllowedModels() === [] (DB-absent
// or the [] default), so an empty list means unconfigured (Req 6.1). This mirrors
// the criteria resolveMastraModel enforces at request time without building a
// model here — callers (guard, sidebar supplier, admin GET) only need a boolean.

// Mirror resolveAzureOpenaiModel's two requirements for the configured-verdict so
// it agrees with the resolver's real success/throw path (Req 6.1), without
// building a model (which, under Entra ID, would construct a token provider).
// Non-Azure (key-based) providers only need the shared apiKey.
const hasRequiredProviderConfig = (provider: AiProvider): boolean => {
  if (provider !== 'azure-openai') {
    return getApiKey() != null;
  }

  const azureOpenaiSettings = configManager.getConfig('ai:azureOpenaiSettings');
  // An endpoint is mandatory regardless of auth: resolveAzureOpenaiModel throws
  // when both resourceName and baseURL are absent, so a credentials-present-but-
  // endpoint-missing Azure deployment must read as unconfigured (not "ready then 500").
  if (
    azureOpenaiSettings?.resourceName == null &&
    azureOpenaiSettings?.baseURL == null
  ) {
    return false;
  }
  // apiKey is waived only under Entra ID (ambient managed identity, no apiKey);
  // otherwise the shared key is required.
  if (azureOpenaiSettings.useEntraId === true) {
    return true;
  }
  return getApiKey() != null;
};

export const isAiConfigured = (): boolean => {
  const provider = configManager.getConfig('ai:provider');
  if (!isAiProvider(provider)) {
    return false;
  }

  if (!hasRequiredProviderConfig(provider)) {
    return false;
  }

  return getAllowedModels().length > 0;
};

// AI is usable only when it is both turned on and configured. Single verdict
// shared by the mastra route guard and the sidebar supplier.
export const isAiReady = (): boolean => isAiEnabled() && isAiConfigured();
