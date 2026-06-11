import { createAnthropic } from '@ai-sdk/anthropic';
import type { MastraModelConfig } from '@mastra/core/llm';

// Thin adapter: create the native Anthropic provider with an explicitly
// injected API key (never relying on the provider's process.env auto-detection)
// and apply the model id. `apiKey` is required by the type (the resolver
// guarantees it), so no runtime guard is needed here.
export const createAnthropicModel = (params: {
  apiKey: string;
  model: string;
}): MastraModelConfig => {
  const { apiKey, model } = params;
  return createAnthropic({ apiKey })(model);
};
