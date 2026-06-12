import { createOpenAI } from '@ai-sdk/openai';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey, requireModel } from './config';

// Resolve the OpenAI chat model from config: explicit apiKey injection only
// (never the provider's process.env auto-detection), then apply the model id.
export const resolveOpenaiModel = (): MastraModelConfig =>
  createOpenAI({ apiKey: requireApiKey() })(requireModel());
