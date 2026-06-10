import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { MastraModelConfig } from '@mastra/core/llm';

// Thin adapter: create the native Google Generative AI provider with an
// explicitly injected API key (never relying on the provider's process.env
// auto-detection) and apply the model id.
export const createGoogleModel = (params: {
  apiKey: string;
  model: string;
}): MastraModelConfig => {
  const { apiKey, model } = params;
  return createGoogleGenerativeAI({ apiKey })(model);
};
