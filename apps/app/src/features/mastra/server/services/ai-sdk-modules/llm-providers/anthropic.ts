import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the Anthropic chat model: explicit apiKey injection only (never the
// provider's process.env auto-detection), then apply the given model id. The
// key is read for THIS provider (requireApiKey('anthropic')); the modelId is passed
// in by the caller (resolveMastraModel parses the effective modelKey and dispatches
// the bare modelId here).
//
// `@ai-sdk/anthropic` is loaded via dynamic import() so its module graph is pulled
// ONLY when an Anthropic model is actually resolved — an instance configured for a
// different provider never pays that memory cost (see llm-providers/index.ts).
// The api key is read BEFORE the import so a misconfigured provider fails fast
// without loading the SDK.
export const resolveAnthropicModel = async (
  modelId: string,
): Promise<MastraModelConfig> => {
  const apiKey = requireApiKey('anthropic');
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  return createAnthropic({ apiKey })(modelId);
};
