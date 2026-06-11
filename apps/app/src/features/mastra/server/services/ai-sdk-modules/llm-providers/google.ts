import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { MastraModelConfig } from '@mastra/core/llm';

import { getModel, requireApiKey } from './config';

// Resolve the Google Generative AI chat model from config: explicit apiKey
// injection only (never the provider's process.env auto-detection), then apply
// the model id.
export const resolveGoogleModel = (): MastraModelConfig =>
  createGoogleGenerativeAI({ apiKey: requireApiKey() })(getModel());
