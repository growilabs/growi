import type { MastraModelConfig } from '@mastra/core/llm';

import {
  AI_PROVIDERS,
  isAiProvider,
} from '~/features/mastra/interfaces/ai-provider';
import { configManager } from '~/server/service/config-manager';

import { modelResolvers } from './llm-providers';
import { resolveEffectiveModelId } from './llm-providers/config';
import {
  addResolvedModelToCache,
  getResolvedModelFromCache,
} from './resolved-model-cache';

export const resolveMastraModel = (modelId?: string): MastraModelConfig => {
  // Resolve (and allow-list validate) the effective model id first. The client
  // value is never trusted: out-of-allowlist / omitted ids fall back to the
  // default; an empty allow-list throws (Req 4.1).
  const effectiveModelId = resolveEffectiveModelId(modelId);

  // `ai:provider` has no default (undefined when unset), and env-loaded config is
  // not runtime-validated against the union, so re-validate here (Req 1.4).
  const provider = configManager.getConfig('ai:provider');
  if (!isAiProvider(provider)) {
    throw new Error(
      `Unsupported Mastra LLM provider "${provider}" (expected one of: ${AI_PROVIDERS.join(', ')})`,
    );
  }

  const cacheKey = `${provider}:${effectiveModelId}`;
  const cached = getResolvedModelFromCache(cacheKey);
  if (cached != null) {
    return cached;
  }

  // Generic dispatch: each provider builds its own model from the effective
  // model id + its own config. The chosen resolver throws on its own
  // misconfiguration — nothing is cached in that case, so a config fix takes
  // effect on the next call.
  const model = modelResolvers[provider](effectiveModelId);
  addResolvedModelToCache(cacheKey, model);
  return model;
};
