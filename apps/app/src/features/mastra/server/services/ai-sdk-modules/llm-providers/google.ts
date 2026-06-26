import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { MastraModelConfig } from '@mastra/core/llm';

import { requireApiKey } from './config';

// Resolve the Google Generative AI chat model: explicit apiKey injection only
// (never the provider's process.env auto-detection), then apply the given model
// id. The modelId is passed in by the caller (resolveMastraModel resolves the
// effective model against the allow-list first).
export const resolveGoogleModel = (modelId: string): MastraModelConfig =>
  createGoogleGenerativeAI({ apiKey: requireApiKey() })(modelId);
