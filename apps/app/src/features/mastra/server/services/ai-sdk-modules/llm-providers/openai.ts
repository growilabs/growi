import { createOpenAI } from '@ai-sdk/openai';
import type { MastraModelConfig } from '@mastra/core/llm';

// Thin adapter: create the native OpenAI provider with an explicitly injected
// API key (never relying on the provider's process.env auto-detection) and
// apply the model id.
export const createOpenAiModel = (params: {
  apiKey: string;
  model: string;
}): MastraModelConfig => {
  const { apiKey, model } = params;
  return createOpenAI({ apiKey })(model);
};
