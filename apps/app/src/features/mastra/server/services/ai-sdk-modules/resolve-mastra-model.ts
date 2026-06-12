import type { MastraModelConfig } from '@mastra/core/llm';

import {
  AI_PROVIDERS,
  isAiProvider,
} from '~/features/mastra/interfaces/ai-provider';
import { configManager } from '~/server/service/config-manager';

import { modelResolvers } from './llm-providers';

// Memoize the resolved model so the native provider object is built once and
// reused across calls. On misconfiguration the function throws (and does not
// memoize), mirroring the existing OpenaiClientDelegator constructor pattern:
// a config fix takes effect on the next call. Throwing — rather than returning
// a sentinel — is safe for app boot because the agent calls this lazily (its
// `model` is a function), so import-time construction never triggers it.
let memoizedModel: MastraModelConfig | undefined;

export const resolveMastraModel = (): MastraModelConfig => {
  if (memoizedModel != null) {
    return memoizedModel;
  }

  // `ai:provider` defaults to 'openai' but env-loaded config is not
  // runtime-validated against the union, so re-validate here (Req 1.4).
  const provider = configManager.getConfig('ai:provider');
  if (!isAiProvider(provider)) {
    throw new Error(
      `Unsupported Mastra LLM provider "${provider}" (expected one of: ${AI_PROVIDERS.join(', ')})`,
    );
  }

  // Generic dispatch: each provider resolves its own model from config. The
  // chosen resolver throws on its own misconfiguration — not memoized, so a
  // config fix takes effect on the next call.
  memoizedModel = modelResolvers[provider]();
  return memoizedModel;
};
