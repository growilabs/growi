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
//   2. credentials are present (the shared API key for key-based auth, OR — for
//      Azure OpenAI with Microsoft Entra ID — an ambient managed identity, which
//      uses no apiKey),
//   3. the operator's allow-list has at least one model.
// The allow-list check replaces the former single ai:model presence test:
// "no allowed models" is always observed as getAllowedModels() === [] (DB-absent
// or the [] default), so an empty list means unconfigured (Req 6.1). This mirrors
// the criteria resolveMastraModel enforces at request time without building a
// model here — callers (guard, sidebar supplier, admin GET) only need a boolean.

// resolveAzureOpenaiModel skips ai:apiKey when ai:azureOpenaiSettings.useEntraId
// === true (it authenticates via a bearer token from DefaultAzureCredential).
// Mirror that exact branch so the configured-verdict agrees with the resolver's
// real auth path — otherwise an Entra-only Azure deployment (no apiKey by design)
// would be wrongly reported unconfigured, regressing the AI gating (Req 6.1).
const requiresApiKey = (provider: AiProvider): boolean => {
  if (provider === 'azure-openai') {
    const settings = configManager.getConfig('ai:azureOpenaiSettings');
    return settings?.useEntraId !== true;
  }
  return true;
};

export const isAiConfigured = (): boolean => {
  const provider = configManager.getConfig('ai:provider');
  if (!isAiProvider(provider)) {
    return false;
  }

  if (requiresApiKey(provider) && getApiKey() == null) {
    return false;
  }

  return getAllowedModels().length > 0;
};

// AI is usable only when it is both turned on and configured. Single verdict
// shared by the mastra route guard and the sidebar supplier.
export const isAiReady = (): boolean => isAiEnabled() && isAiConfigured();
