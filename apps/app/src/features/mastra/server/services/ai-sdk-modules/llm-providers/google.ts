import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the Google Generative AI chat model: explicit apiKey injection only
// (never the provider's process.env auto-detection), then apply the given model
// id. The key is read for THIS provider (requireApiKey('google')); the modelId is
// passed in by the caller (resolveMastraModel parses the effective modelKey and
// dispatches the bare modelId here).
//
// `@ai-sdk/google` is loaded via dynamic import() so its module graph is pulled
// ONLY when a Google model is actually resolved — an instance configured for a
// different provider never pays that memory cost (see llm-providers/index.ts).
// The api key is read BEFORE the import so a misconfigured provider fails fast
// without loading the SDK.
export const resolveGoogleModel = async (
  modelId: string,
): Promise<MastraModelConfig> => {
  const apiKey = requireApiKey('google');
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  return createGoogleGenerativeAI({ apiKey })(modelId);
};
